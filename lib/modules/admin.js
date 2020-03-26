/**
 * @file Admin Manager Server Module
 */
"use strict";
var fs = require('fs');
var http = require('http');
var util = require('../core/util');
var CONST = require('../core/const');
var querystring = require('querystring');
var log = util.log;

var gAdminServer = null;
var gDaemon = null;
var gAdminConfig = {
	'id': 'DAEMON'
};

var gProcessStatus = new Map();
var gProcessMaxMem = 0;

var monitor;

exports.setMonitor = function(v)
{
	monitor = v;
};
exports.init = function(daemon)
{
	gDaemon = daemon;
};
/* 启动admin web服务器 */
exports.startWebServer = function(config)
{
	if(process.platform == 'linux')
	{
		try
		{
			monitor = require('monitor').server;
			monitor.init(config.monitor_port);
		}
		catch(e){log(4, 'No Monitor Module');}
	}
	gAdminConfig = config;
	var opt = util.formatNetAddress(config.listen, true);
	log(1, 'Starting admin server on: ' + config.listen);

	// start http server
	gAdminServer = http.createServer();
	gAdminServer.listen.apply(gAdminServer, opt);

	gAdminServer.on(
		'error',
		function(err)
		{
			log(4, 'Admin HTTP Server error:', err);
		}
	)
	.on('request', onAdminHttpRequest);
}

exports.stopWebServer = function()
{

}
/**
 * 初始化admin客户端
 * 
 * @param {Number} id 进程ID
 * @param {NodeProcess} proc NodeProcess进程实例
 * @param {func} cmd_fn admin命令管理回调函数
 */
exports.initClient = function(id, proc, cmd_fn)
{
	gAdminConfig = {
		'id': id,
		'proc': proc,
		'cmd_fn': cmd_fn
	};

	// update process stat now
	AdminActions.stat();
	gAdminConfig.update_timer = setInterval(AdminActions.stat, 10000);
}

exports.stopClient = function()
{

}

// admin server http api process function
var HTTP_FILE_TYPES = {
	'png': 'image/png',
	'gif': 'image/gif',
	'jpg': 'image/jpeg',
	'jpeg': 'image/jpeg',
	'json': 'application/json',
	'js': 'application/x-javascript; charset=utf-8',
	'css': 'text/css',
	'html': 'text/html; charset=utf-8',
	'htm': 'text/html; charset=utf-8',
	'ico': 'image/x-icon'
};
/* requeset 请求 */
function onAdminHttpRequest(req, res)
{
	var uri = req.url;

	if (uri.slice(0, 5) != '/api/')
	{
		return onAdminRequestResource(req, res);
	}

	var pass = gAdminConfig.password;
	var salt_key = gAdminConfig.salt_key || '_DA_SALT';
	var pass_key = gAdminConfig.pass_key || '_DA_PASS';
	var cookie = req.headers.cookie;
	var checked = !pass;
	var reply = replyHttp.bind(res, res);
	if (pass && cookie)
	{
		cookie = require('querystring').parse(cookie, '; ');
		if (cookie[salt_key] && cookie[pass_key])
		{
			checked = (cookie[pass_key] == util.md5(pass, cookie[salt_key]));
		}
	}

	res.writeHead(200, {'Content-Type': 'application/json'});

	if (!checked)
	{
		// output the error
		reply(1, "auth failure");
	}
	else
	{
		var param = [];

		req.on('data', function(data){
			param.push(data);
		});
		req.on('end', function(){
			if (param.length)
			{
				param = Buffer.concat(param).toString();
				try {
					param = JSON.parse(param);
				}
				catch (e)
				{
					reply(2, "param format error");
					return;
				}
			}
			else
			{
				param = {};
			}

			var t = uri.slice(5).split('?');
			uri = t[0];
			if(util.isEmpty(param.length) && t[1])
			{
				param = querystring.parse(t[1]);
			}

			if (ApiActions[uri])
			{
				try {
					ApiActions[uri](param, reply, res);
				}
				catch (err)
				{
					reply(4, err.toString());
				}
			}
			else
			{
				reply(3, 'unknow api');
			}
		});
	}
}
/* 静态文件资源处理 */
function onAdminRequestResource(req, res)
{
	if (req.method != 'GET')
	{
		res.writeHead(405, {'Connection': 'close'});
		res.end('Method Not Allowed');
		return;
	}

	var path = gAdminConfig.http_root + req.url.split('?', 1).pop();
	if (path.slice(-1) == '/')
	{
		path += 'index.html';
	}

	if (fs.existsSync(path))
	{
		// check file content type
		var ext = path.split('.');
		ext = ext.length > 1 ? ext.pop().toLowerCase() : '';
		if (ext && HTTP_FILE_TYPES[ext]){
			res.setHeader('content-type', HTTP_FILE_TYPES[ext]);
		}

		// create read stream and output
		var stream = fs.createReadStream(path);
		stream.pipe(res);
	}
	else
	{
		// file not found
		res.writeHead(404, {'Connection': 'close'});
		res.end('File Not Found');
	}
}

function replyHttp(res, code, data)
{
	if (arguments.length < 3)
	{
		data = code;
		code = 0;
	}

	if (code)
	{
		res.end(JSON.stringify(
			{'succ': false, 'code': code, 'message': data}
		));
	}
	else
	{
		res.end(JSON.stringify(
			{'succ': true, 'code': 0, 'data': data}
		));
	}
}


var checkTimerId = 0;
var requestWaits = new Map();
var requestId = 0;

function throwError(code, message)
{
	throw {'code': code, 'message': message};
}

// admin master process request client process function
function sendRequest(proc, msg, callback)
{
	proc.send(CONST.MSG_REQ, msg);
	if (callback)
	{
		requestWaits.set(msg.mid, [Date.now(), callback]);
		if (!checkTimerId)
		{
			checkTimerId = setInterval(checkRequestTimeout, 5000);
		}
	}
}

function checkRequestTimeout()
{
	var to = Date.now() - 60000;
	for (var pair of requestWaits)
	{
		if (pair[1][0] < to)
		{
			requestWaits.delete(pair[0]);
			pair[1][1](12, 'request timeout');
		}
	}

	if (requestWaits.size <= 0)
	{
		clearInterval(checkTimerId);
		checkTimerId = 0;
	}
}

function replyRequest(mid, code, data)
{
	gAdminConfig.proc.send(
		CONST.MSG_ACK,
		{
			'type': 'ack',
			'rid': mid,
			'code': code,
			'data': data
		}
	);
}
exports.replyRequest = replyRequest;

function sendClientMessage(type, data)
{
	gAdminConfig.proc.send(
		CONST.MSG_ACK,
		{
			'type': type,
			'data': data
		}
	);
}
exports.notify = sendClientMessage;

function processRequest(type, id, data, callback)
{
	var mid = ++requestId;
	var msg = {
		'id': id,
		'mid': mid,
		'req': (callback ? 1 : 0),
		'type': type,
		'data': data
	};

	var procs = gDaemon ? gDaemon.getProcess() : [];
	var p, proc;
	if (id)
	{
		// find the target process
		for (p of procs)
		{
			if (p.getName() == id)
			{
				sendRequest(p, msg, callback);
				return 0;
			}
			else if (id.indexOf(p.getName()) === 0)
			{
				proc = p;
			}
		}

		if (proc)
		{
			// get route process, pass message to the process
			sendRequest(proc, msg, callback);
		}
		else
		{
			if (callback)
			{
				callback(11, 'process not found');
			}
			return -1;
		}
	}
	else
	{
		// cast to all process
		for (proc of procs)
		{
			proc.send(CONST.MSG_REQ, msg);
		}
	}
	return 0;
}

// system admin message process
exports.onClientMessage = function (source_process, message)
{
	var type = message.type;
	if (type == 'ack')
	{
		// client request reply message
		var req = requestWaits.get(message.rid);
		if (req)
		{
			requestWaits.delete(message.rid);
			req[1](message.code, message.data);
		}
	}
	else if (ClientActions[type])
	{
		// client process push event message
		ClientActions[type](source_process, message.data);
	}
};

exports.onAdminMessage = function(message)
{
	var type = message.type;

	if (AdminActions[type])
	{
		try {
			var result = AdminActions[type](message.data);
			replyRequest(message.mid, 0, result);
		}
		catch (err)
		{
			console.log('onAdminMessage Exception', err.stack);
			replyRequest(
				message.mid,
				(err.code || 99),
				(err.message || err.toString())
			);
		}
	}
	else if (message.req)
	{
		replyRequest(message.mid, 3, 'not impl');
	}
};

// client to admin function
var ClientActions = {
	// process status update event
	stat: function(proc, data)
	{
		var now = Date.now();
		var item = gProcessStatus.get(data.id);
		if (!item)
		{
			item = {
				'updates': 1,
				'restart': 0,
				'pid': data.pid,
				'deads': []
			};
			gProcessStatus.set(data.id, item);
		}
		else if (item.pid != data.pid)
		{
			// process changed, exited?
			item.restart++;
			item.pid = data.pid;
			item.cur.end = now;
			item.deads.unshift(item.cur);
			item.deads.splice(50, 1);
		}

		item.updates++;
		data.active = now;
		item.cur = data;
	}
};

// admin to client event
var AdminActions = {
	stat: function()
	{
		// update process status
		var mem = process.memoryUsage();
		var stat = {
			'id': gAdminConfig.id,
			'pid': process.pid,
			'uptime': process.uptime(),
			'mem': mem
		};

		if (mem.rss > gProcessMaxMem)
		{
			gProcessMaxMem = mem.rss;
		}
		mem.max = gProcessMaxMem;

		if (gAdminConfig.cmd_fn)
		{
			stat.status = gAdminConfig.cmd_fn('status');
		}

		sendClientMessage('stat', stat);
		return true;
	},
	dump: function(path)
	{
		// call current process action
		var hd = require('heapdump');
		var now = new Date();
		path += gAdminConfig.id + '-' + process.pid + '-';
		path += now.toLocaleDateString().replace(/[^\d]/g, '') + '-';
		path += ('0' + now.getHours()).slice(-2);
		path += ('0' + now.getMinutes()).slice(-2);
		path += ('0' + now.getSeconds()).slice(-2);
		path += '.heapsnapshot';

		if (hd.writeSnapshot(path))
		{
			return path;
		}
		else
		{
			throwError(10, 'write heapdump error: ' + path);
		}
	},
	reload: function()
	{
		util.reload_config();
		log(1, 'Process %s reload the config cache', gAdminConfig.id);
	},
	config: function(data)
	{
		return util.get_config_cache_stat();
	},
	halt: function(data)
	{
		setTimeout(
			function()
			{
				process.exit(9);
			},
			100
		);

		return true;
	},
	clear: function(data)
	{
		var res;
		if (gAdminConfig.cmd_fn && (res = gAdminConfig.cmd_fn('clear', data)))
		{
			// request the process to clear jobs
			return res;
		}

		throwError(13, 'no process command call function.');
	},
	stop: function(data)
	{
		var res;
		if (gAdminConfig.cmd_fn && (res = gAdminConfig.cmd_fn('stop', data)))
		{
			// request the process to stop
			return res;
		}

		throwError(13, 'no process command call function.');
	}
};

// http api function
var ApiActions = {
	stat: function(data, reply, res)
	{
		var mem = process.memoryUsage();
		mem.max = mem.rss;
		var stat = [
			{
				'id': gAdminConfig.id,
				'pid': process.pid,
				'active': Date.now(),
				'uptime': process.uptime(),
				'updates': 0,
				'restart': 0,
				'mem': mem
			}
		];
		for (var pair of gProcessStatus){
			pair[1].cur.updates = pair[1].updates;
			pair[1].cur.restart = pair[1].restart;
			stat.push(pair[1].cur);
		}
		reply(stat);
	},
	dump: function(data, reply, res)
	{
		var id = data.id;
		if (id == gAdminConfig.id)
		{
			// call current process action
			var hd = require('heapdump');
			var now = new Date();
			var path = gAdminConfig.dump_path;
			path += gAdminConfig.id + '-' + process.pid + '-';
			path += now.toLocaleDateString().replace(/[^\d]/g, '') + '-';
			path += ('0' + now.getHours()).slice(-2);
			path += ('0' + now.getMinutes()).slice(-2);
			path += ('0' + now.getSeconds()).slice(-2);
			path += '.heapsnapshot';

			if (hd.writeSnapshot(path))
			{
				reply(0, path);
			}
			else
			{
				reply(10, 'write heapdump error: ' + path);
			}
		}
		else if (id)
		{
			processRequest('dump', id, gAdminConfig.dump_path, reply);
		}
		else
		{
			reply(11, 'process id not found');
		}
	},
	reload: function(data, reply, res)
	{
		var id = data.id;

		// reload current process
		if (!id || id == gAdminConfig.id)
		{
			AdminActions.reload();
		}

		// request the process to reload config file
		processRequest('reload', id, data);

		reply(0, 'process config reloading.');
	},
	config: function(data, reply, res)
	{
		var id = data.id;

		if (id == gAdminConfig.id)
		{
			reply(0, AdminActions.config());
		}
		else if (id)
		{
			processRequest('config', id, data, reply);
		}
		else
		{
			reply(11, 'process id not found');
		}
	},
	daemon: function(data, reply, res)
	{
		switch (data.act)
		{
			case 'stop':
			case 'kill':
			case 'restart':
			case 'reload':
				gDaemon[data.act](data.param);
				reply(0, 'daemon action called');
				break;
			default:
				reply(15, 'action invalid');
				break;
		}
	},
	halt: function(data, reply, res)
	{
		var id = data.id;

		if (id && id != gAdminConfig.id)
		{
			processRequest('halt', id, data, reply);
		}
		else
		{
			reply(11, 'process id not found');
		}
	},
	resume_process: function(data, reply, res)
	{
		var id = +data.id;
		if(monitor && id)
		{
			var msg = monitor.resume(id);
			reply(0, {message: msg || '恢复成功'});
		}
		else
		{
			reply(13, {message: '没法满足的请求。'})
		}
	},
	stop_process: function(data, reply, res)
	{
		var id = +data.id;
		if(monitor && id)
		{
			var msg = monitor.pause(id);
			reply(0, {message: msg || '暂停成功'});
		}
		else
		{
			reply(13, {message: '没法满足的请求。'})
		}
	},
	stack: function(data, reply, res)
	{
		var id = +data.id;
		if(monitor && id)
		{
			var msg = monitor.print_stack(id);
			reply(0, {message: msg || ''});
		}
		else
		{
			reply(13, {message: '没法满足的请求。'})
		}
	}
};