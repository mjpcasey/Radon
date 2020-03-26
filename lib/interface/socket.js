/**
 * @file Radon WebSocket Interface for NodeJS
 */
"use strict";

var base = require('../core/base');
var util = require('../core/util');
var error = require('../core/error');
var CONST = require('../core/const');
var io   = require('socket.io');
var http = require('http');
var fs   = require('fs');
var querystring = require('querystring');

var LinkClient = require('../core/link_client');
var serialize = require('../core/serialize');
var json_64 = util.require('../core/json64');
var LOG_FILE_PATH;

module.exports = base.Class.extend({
	init: function(config, ipc, last, tran)
	{
		var self = this;

		// global ipc object
		self._ipc = ipc;

		// module status
		// self._request_count = 0;
		self._status = false;
		self._transaction = tran;

		// module config param
		self._uri_prefix      = config.prefix || '';
		self._link_event_uri  = config.link_event_uri || false;
		self._request_timeout = (config.request_timeout || 60) * 1000;
		self._init_timeout    = (config.init_timeout || 15) * 1000;
		// 不写socket日志文件
		self._no_log_request = config.no_log_request;

		// cookie 默认参数
		self._cookie_option   = config.cookie_option || {};
		self._sess_cookie     = config.sess_cookie || false;
		LOG_FILE_PATH = config.log_file || util.normalizePath('/../var/log/socket_');


		// link manager object
		self._links = null;

		// socket config
		self._listen = config.listen;
		if (!self._listen)
		{
			util.log(23, 'Missing WebSocket listen config, using the random port');
			self._listen = Math.round(9000 + Math.random() * 1000);
		}

		if (last)
		{
			if (last._listen == self._listen)
			{
				// use the same port, try to use the old server object
				self._server = last._server;
				self._io = last._io;
				self._links = last._links;

				// unbind the old event
				self._io.removeAllListeners();
			}
			else
			{
				// free old server
				last.free();
			}
		}

		if (!self._links)
		{
			self._links = new LinkClient(ipc, {
				'timeout': (config.link_timeout || 120),
				'touchtime': (config.link_touch_time || 60),
				'interval': (config.link_interval || 30),
				'prefix': ipc.id,
				'module': config.name
			});
		}

		if (!self._server)
		{
			self._server = http.createServer();
			self._server.listen.apply(
				self._server,
				util.formatNetAddress(self._listen, true)
			);
			self._io = io(self._server, {'path': config.path});
		}

		// bind the server socket event
		self._io
			.on(
				'error',
				function(err)
				{
					util.log(24, 'Socket.io error: ', err);
				}
			)
			.on(
				'connection',
				function (socket){
					// check if module unloading
					if (self._status)
					{
						socket.disconnect();
						return;
					}
					self._transaction.enter();
					self.onConnection(socket).then(
						self._transaction.leave,
						self._transaction.leave
					);
				}
			);

		util.log(21, 'Socket.io (%s) listen on %s', config.path, self._listen);
	},

	// free the resource
	free: function()
	{
		if (this._io)
		{
			this._io.close();
			this._io = null;
		}

		if (this._server)
		{
			this._server.close();
			this._server = null;
		}

		// todo: close all client link
	},
	// 卸载该模块
	unload: function(status, transaction)
	{
		this._status = status;

		switch (status)
		{
			case CONST.STATUS_STOPPING:
			case CONST.STATUS_STOP:
				this.free();
				break;
		}
	},
	/* 对外的接口列表 */
	getEvents: function()
	{
		var self = this;
		var evts = [
			['*', self.onDispatchMessage]
		];

		if (self._links)
		{
			var evt = self._links.getNotifyEvent();
			evts.push([evt[0], self.onLinkNotify]);
			evt = self._links.getRemoveEvent();
			evts.push([evt[0], self.onLinkRemove]);
		}
		return evts;
	},
	/* 连接删除 */
	onLinkRemove: function(req, res)
	{
		var self = this;
		var link = self._links.get(req.get('link_id'));
		if(link && link.socket)
		{
			link.socket.emit('removeLink');
			link.socket.removeAllListeners();
			link.socket.disconnect();
		}
	},

	onLinkNotify: function(req, res)
	{
		var self = this;
		var link_id = req.get('id');
		var link = self._links.get(link_id);
		if (link){
			processActions.call(self, link, req.get('actions'));
			res.done(true);
		}
		else
		{
			return false;
		}
	},

	onDispatchMessage: function(req)
	{
		var self = this;
		var args = arguments;
		var link_id;

		if (req.getHeader('group'))
		{
			// 广播消息包处理
			self.onCastMessage.apply(self, args);
		}
		else if (link_id = req.getHeader('link_id'))
		{
			// 普通推送消息包
			var link = self._links.get(link_id);
			// 连接有效, 并且有 socket 连接
			if (link && link.socket){
				args = util.toArray(args);
				args.unshift(link);
				self.onPushMessage.apply(self, args);
			}
		}
	},

	// 客户端 webSocket 连接处理
	onConnection: util.generator(function *(socket)
	{
		var self = this;
		var link_id = 0;

		// wait for client init message, and set timeout
		try
		{
			let tid;
			link_id = yield new Promise(function(done, fail){
				tid = setTimeout(fail, self._init_timeout);
				socket.once('initLink', done);
			});
			clearTimeout(tid);
		}
		catch (error)
		{
			socket.removeAllListeners();
			socket.disconnect();
			return;
		}

		// got client init message, with data link_id
		try
		{
			var COOKIES = parseCookie(socket);
			var CLIENTIP = parseIp(socket);
			var link_old = 0;
			var link = {
				'id': 0,
				'session': 0,
				'socket': socket,
				'send': sendClientMessage,
				'cookie': COOKIES,
				'active': 1,
				'client_ip': CLIENTIP
			};

			// has link manager, init link record
			if (self._links)
			{
				if (link_id)
				{
					// check client link_sn valid
					link_old = link_id;
					let old = self._links.get(link_id);

					if (old)
					{
						link = old;
						// free last socket
						let so = link.socket;
						if (so)
						{
							so.removeAllListeners('message');
							if (!so.disconnected)
							{
								so.disconnect();
							}
						}

						// save the new socket
						link.socket = socket;
						link.active++;

						// join link group room
						let groups = self._links.getGroups(link_id);
						for (let group of groups)
						{
							socket.join(group);
						}
					}
				}

				// no old link, create one
				if (!link.id)
				{
					link_id = yield self._links.create(link);

					if (!link_id)
					{
						// register link fail
						error.throw(3200);
					}

					// process link client info object
					link.id = link_id;

				}

				// process session cookie, find the session id
				if (self._sess_cookie && COOKIES[self._sess_cookie])
				{
					// 判断是否有 session_token, 有则获取对应 session_id
					let sess_token = COOKIES[self._sess_cookie];
					if (sess_token)
					{
						if (Array.isArray(sess_token))
						{
							sess_token = sess_token.pop();
						}

						// save the session id for client message
						link.session = yield self._links.getSessionId(link_id, sess_token);
					}
				}
			}

			// because no bind the error event, check socket connection
			if (socket.disconnected)
			{
				// client closed, free count
				link.active--;
				return;
			}

			// bind the socket event
			socket.on(
				'message',
				self.onClientMessage.bind(self, link, link_id, socket)
			);
			socket.on(
				'disconnect',
				self.onClientDisconnect.bind(self, link, link_id, socket)
			);
			socket.on(
				'Ping',
				self.onClientPing.bind(self, link, link_id, socket)
			);
			

			// 设置过期时间在 1 个月后, 连接断开时会修正
			self._links.active(link_id, true);

			// 判读连接是否已经超时, 发送重连初始化事件
			if (self._link_event_uri && link_id && link_old != link_id)
			{
				yield self._ipc.request(
					{
						'uri': self._link_event_uri,
						'link_id': link_id,
						'session_id': link.session
					}
				);
			}

			// websocket init finish, ack link id
			socket.emit('ackLink', link_id);

			util.log(
				20,
				'Init WebSocket Link: %s (link: %s, session: %d, last: %s)',
				self._link_event_uri, link_id, link.session, link_old
			);
		}
		catch (error)
		{
			util.log(24, 'WebSocket Init Link Exception:\n%s', error.stack || error);
			socket.emit('ackLink', 0, error);
			socket.removeAllListeners();
			socket.disconnect();
		}
	}),
	// 客户端 webSocket 事件消息
	onClientMessage: util.generator(function *(link, link_id, socket, message)
	{
		try
		{
			// mid	- 客户端消息ID
			// type	- message / abort 消息类型
			// req	- 是否请求同步返回消息
			// uri	- 业务消息标识符
			// data	- 业务消息参数
			message = serialize.decode(message);
			var self = this;
			if (!self._no_log_request) {
				logRequest(message);
			}
			var res;
			var header = {
				'uri': self._uri_prefix + message.uri,
				'link_id': link_id,
				'cookie': link.cookie,
				'session_id': link.session,
				'timeout': self._request_timeout,
				'ref': message.mid,
				'client_ip': link.client_ip
			};

			if (message.req)
			{
				res = {
					'type': 'message',
					'mid': 0,
					'rid': message.mid,
					'uri': message.uri,
					'error': null,
					'data': null
				};
			}

			// xss字符检查
			util.xssCheck(message.data, message.uri, 'websocket');

			// check if module unloading
			if (self._status)
			{
				error.throw(3007);
			}
			self._transaction.enter();

			if (message.req)
			{
				var timer = setTimeout(function(){
					message.type = "message end timeout";
					message.success = false;
					message.status = "timeout for 5min";
					if (!self._no_log_request) {
						logRequest(message);
					}
					util.log(24, 'WebSocket request time warning', message);
					// time out send the abort message to cancel the request.
					//self._ipc.abort(header, message.data);
				}, 300000);
				try
				{
					let result = yield self._ipc.requestResult(
						header,
						message.data
					);
					res.data = result.get();
					res.mid = result.getHeader('mid');
					link.send(res);
					message.type = "message end";
					if (!self._no_log_request) {
						logRequest(message);
					}
				}
				catch (err)
				{
					message.type = "message end error";
					logRequest(message);
					res.error = err.get();
					link.send(res);
				}
				clearTimeout(timer);

			}
			else if (message.type == 'abort')
			{
				util.log(20, 'Socket Get The abort Msg: %s', message.uri);
				yield self._ipc.abort(header, message.data);
			}
			else
			{
				yield self._ipc.send(header, message.data);
			}

			self._transaction.leave();
		}
		catch (err)
		{
			// if (err.code == 3007){
			if (err.radon_error){
				if (res){
					res.error = {'code': err.code, 'message': err.message};
					link.send(res);
				}
				return;

			}
			util.log(24, 'Socket Message Format Decode Error: %s', err.stack);
		}
	}),
	/* 前端心跳信号 */
	onClientPing: function(link, link_id, socket, message)
	{
		var t = Date.now() - message.time;
		util.log(101, `Ping Time: ${t}, IP: ${link.client_ip}`);
	},
	// 客户端 webSocket 连接断开事件
	onClientDisconnect: function(link, link_id, socket)
	{
		var self = this;
		// 取消 socket 的事件绑定
		socket.removeAllListeners();

		// 清除缓存的 socket 对象
		if (link.socket === socket)
		{
			link.socket = null;
		}

		// 减少连接活跃数
		link.active--;
		if (link.active <= 0)
		{
			self._links.active(link_id, false);
		}
		util.log(20, '连接断开, link_id: %s, active: %d', link_id, link.active);
	},

	// process cast message
	onCastMessage: function(req, res)
	{
		var self = this;
		var links = self._links.getLinksByGroup(req.getHeader('group'));
		if (links.length > 0)
		{
			var link;
			var err = req.getHeader('err');
			var msg = serialize.encode(
				{
					'type': 'message',
					'mid': req.getHeader('mid'),
					'uri': req.getHeader('event'),
					'error': err ? req.get() : null,
					'data': err ? null : req.get()
				}
			);
			while (link = links.pop())
			{
				if (link.socket && !link.socket.disconnected)
				{
					link.socket.send(msg);
				}
			}
		}
	},
	// process client push message
	onPushMessage: function(link, req)
	{
		var err = req.getHeader('err');
		link.send(
			{
				'type': 'message',
				'mid': req.getHeader('mid'),
				'rid': req.getHeader('ref') || 0,
				'uri': req.getHeader('event'),
				'error': err ? req.get() : null,
				'data': err ? null : req.get()
			}
		);
	}
});


var old = util.date('Ymd', new Date());
function logRequest(message)
{
	try
	{
		var msg = json_64.stringify(message) + '\n';
	}
	catch (e)
	{
		try {
			msg = JSON.stringify(message) + '\n';
		}
		catch(e) {
			msg = message;
		}
	}

	var t = new Date();
	msg = t.toLocaleString() + ',' + msg;
	var now = util.date('Ymd', t);
	if(old != now)
	{
		old = now;
	}

	fs.writeFile(`${LOG_FILE_PATH}${old}.log`, msg, {flag: 'a'});
}

/* 格式化数据，并发送给前端 */
function sendClientMessage(message)
{
	if (this.socket && !this.socket.disconnected)
	{
		return this.socket.emit('message', serialize.encode(message));
	}
	else
	{
		return false;
	}
}
/* 解析cookie */
function parseCookie(socket)
{
	if (socket.request &&
		socket.request.headers &&
		socket.request.headers.cookie)
	{
		return querystring.parse(socket.request.headers.cookie, '; ');
	}
	else
	{
		return {};
	}
}
/* 解析出客户端IP */
function parseIp(socket)
{
	if (socket.request &&
		socket.request.headers &&
		socket.request.headers.__client__ip__)
	{
		return socket.request.headers.__client__ip__ || '';
	}
	else
	{
		return '';
	}
}

// 规格化 cookie 参数
function cookieParam(def, name, value, expires){
	switch ('object'){
		case typeof(name):
			return formatCookieParam(name, def);
		case typeof(value):
			return formatCookieParam(value, def);
		case typeof(expires):
			var param = formatCookieParam(expires, def);
			param.name  = name;
			param.value = value;
			return param;
		default:
			return formatCookieParam({
				'name': name,
				'value': value,
				'expires': expires
			}, def);
	}
}
var cookie_props = [
	'name', 'value', 'domain', 'path',
	'expires', 'httpOnly', 'secure'
];
function formatCookieParam(param, def){
	var opts = {};
	for (var prop in cookie_props){
		prop = cookie_props[prop];
		if (param.hasOwnProperty(prop) && param[prop] !== undefined){
			opts[prop] = param[prop];
		}else if (def.hasOwnProperty(prop) && def[prop] !== undefined){
			opts[prop] = def[prop];
		}
	}
	if (opts.expires && opts.expires instanceof Date){
		opts.expires = opts.expires.getTime();
	}
	return opts;
}


function processActions(link, actions)
{
	var self = this;
	var cookies = new Map();

	for (var act of actions)
	{
		// only support set cookie and update session
		switch (act[0])
		{
			case 'RADON.SET_COOKIE':
				cookies.set([1].name, act[1]);
				break;

			case 'RADON.SET_SESSION':
				link.session = act[1].session_id;

				self._links.setSession(
					link.id,
					act[1].session_id,
					act[1].session_token
				);

				if (self._sess_cookie)
				{
					cookies.set(
						self._sess_cookie,
						act[1].session_token
					);
				}
				break;

			case 'RADON.SET_GROUPS':
				var g, groups;
				if (link.socket)
				{
					// exit old group channel
					link.socket.leaveAll();

					// join the new channel
					groups = act[1];
					for (g = groups.length; g --> 0;)
					{
						link.socket.join(groups[g]);
					}
				}
				// update current link group channel
				self._links.setGroups(link.id, act[1]);
				break;

			// default message send to client side
			default:
				link.send({
					'type': 'message',
					'mid': 0,
					'rid': 0,
					'uri': act[0],
					'error': null,
					'data': act[1]
				});
				break;
		}
	}

	// process cookie action
	if (cookies.size && link.socket && !link.socket.disconnected)
	{
		var list = [];
		for (var ck of cookies)
		{
			list.push(
				cookieParam(self._cookie_option, ck[0], ck[1])
			);
		}

		link.socket.emit('setCookie', list, true);
	}
}