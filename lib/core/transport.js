/**
 * @file Radon Transport Module for NodeJS
 * -----------------------------------------
 * Manager all process endpoint and user session data
 * log level: 10 - transport framework
 */

"use strict";
var util = require('./util');
var error = require('./error.js');
var log = util.log;
var serialize = require('./serialize');

/**
 * 进程管理和用户会话数据管理类、链接管理
 * 
 * @constructor
 * @param proc_name -进程名称
 * @param config -对应进程的配置
 * @prop {string} setting.router -路由管理模块
 * @prop {string} setting.session -指定会话管理模块
 * @prop {string} setting.link -指定链接管理模块
 */
function Manager(proc_name, config, setting){
	var self = this;
	self._mid = 0;
	self._config = config;
	self._process_name = proc_name;
	self._session_uri = setting.session;
	self._router_uri = setting.router;
	self._get_route_uri = null;
	self._link_uri = setting.link;

	self._request_timeout = (setting.request_timeout || 30) * 1000;
	self._requests = new Map();

	// 绑定 IPC 回调函数
	self._callbacks = {
		'send': function(){}
	};

	// parse router uri, must has the dest process
	if (self._router_uri)
	{
		var header = formatHeader(self._router_uri);
		if (header.process)
		{
			header.event = 'getRoute';
			self._get_route_uri = header;
		}
	}

	// 启动请求超时检查纤程
	setInterval(checkRequestTimeout.bind(self), 1000);
}
exports.Manager = Manager;

/**
	Message Structure
	mid *- message id
	type *- message type string
	timeout - request timeout (ms)
	rid - request messasge id
	ext - extend request info
	rext - source extend request info
	uri - mesage destination uri string
	source_process - source process
	source_module - source module
	process - destination process
	module - destination module
	om - origin destination module
	event - message event
	err - message status (0: success, 1: error)
	session_id - session id
	link_id - link id
	response_header - response headers
	group - cast message group
	ref - referer message id

	data - message data content
**/
/**
 * 设置IPC回调函数
 * 
 * @prop {function} callbacks.send -{@link NodeProcess#send}
 * @prop {function} callbacks.onSend -ipc类型为 send 时的回调
 * @prop {function} callbacks.onRequest -ipc类型为 req 时的回调
 */
Manager.prototype.setCallbacks = function(callbacks) {
	this._callbacks = callbacks;
};
/**
 * ipc 通信
 * 
 * @param {Object} header -头部信息
 *  { 
 *  	module: Srting
 *	 	group: String
 *		process: String
 *		event: String
 *		[type: String]
 *		[mid: Number]
 *		[source_process: Sting]
 *	}
 * @param {object} data -待发送的数据
 */
Manager.prototype._ipcSend = function(header, data) {
	var self = this;

	// local process trigger by ownself
	if (header.process === self._process_name)
	{
		process.nextTick(function(){
			self.onMessage([header, data], true);
		});
	}
	else
	{

		self._callbacks.send([header, serialize.rawEncode(data)]);
	}
};
/**
 * 格式化IPC发送的头部信息
 * 
 * @param {string} method -消息类型 e.g. req send arort...
 * @param {string} header -类似格式: [#] [module]{[group]}@[process]:[event]的字符串
 * @returns {Promise} 格式化后的header
 */
Manager.prototype._formatHeader = function(method, header) {
	var self = this;
	header = formatHeader(header);

	if (method){
		header.type = method;
	}
	header.mid = ++self._mid;
	header.source_process = self._process_name;

	if (header.process)
	{
		return util.promiseResolve(header);
	}
	else
	{
		var param = {
			'uri': header.uri,
			'module': header.module,
			'group': header.group
		};
		return self._getRoute(param).then(
			function(route)
			{
				var key;
				for (key in route){
					header[key] = route[key];
				}
				return header;
			}
		);
	}
};
/**
 * 请求路由模块查找相应路由
 */
Manager.prototype._getRoute = function(param) {
	if (this._get_route_uri){
		var header = {};
		for (var name in this._get_route_uri)
		{
			header[name] = this._get_route_uri[name];
		}
		return this.request(header, param);
	}else {
		// throw exception
		error.throw(3302);
	}
};

// session function call, return a promise
Manager.prototype._requestSession = function(fn, params) {
	if (this._session_uri){
		return this.request(this._session_uri + ':' + fn, params);
	}else {
		// throw exception
		error.throw(3300);
	}
};

// session function call, return a promise
Manager.prototype._requestLink = function(fn, params) {
	if (this._link_uri){
		return this.request(this._link_uri + ':' + fn, params);
	}else {
		// throw exception
		error.throw(3301);
	}
};
// 获取当前进程的进程名称
Manager.prototype.currentProcess = function() {
	return this._process_name;
};

// bypass message to another module or process
Manager.prototype.pass = function(header, data) {
	var self = this;
	if (header.process)
	{
		self._ipcSend(header, data);
		return util.promiseResolve(header);
	}
	else
	{
		return self._getRoute(header).then(
			function(route)
			{
				for (var key in route){
					header[key] = route[key];
				}
				self._ipcSend(header, data);
				return header;
			}
		);
	}
};

// send a message without reply
Manager.prototype.send = function(header, data, type) {
	var self = this;
	return self._formatHeader((type || 'send'), header).then(
		function(header){
			// check cast header, trigger self process
			if (Array.isArray(header.process))
			{
				var hasLocal = false;
				header.process = header.process.filter(
					function(val)
					{
						if (val == self._process_name)
						{
							hasLocal = true;
							return false;
						}
						else
						{
							return true;
						}
					}
				);

				// send message to daeman process
				self._ipcSend(header, data);

				// trigger local message if has local process_name
				if (hasLocal)
				{
					header.process = self._process_name;
					self.onMessage([header, data]);
				}
			}
			else
			{
				self._ipcSend(header, data);
			}

			return header;
		}
	);
};

// request a message and wait for the reply
Manager.prototype.request = function(header, data, as_result) {
	var self = this;
	return self._formatHeader('req', header)
		.catch(
			function(err)
			{
				if (as_result && !(err instanceof Result))
				{
					throw new Result({'err': 1, 'mid': 0}, err);
				}
				else
				{
					throw err;
				}
			}
		)
		.then(
			function(header)
			{
				return util.promise(function(done, err){
					// request timeout and result callback
					header.timeout = (header.timeout || self._request_timeout);
					self._requests.set(
						header.mid,
						[
							Date.now() + header.timeout,
							as_result,
							done, err
						]
					);

					// send the message
					self._ipcSend(header, data);
				});
			}
		);
};

// request a message and wait for the reply
Manager.prototype.abort = function(header, data, as_result) {
	var self = this;
	return self._formatHeader('abort', header)
		.catch(
		function(err)
		{
			if (as_result && !(err instanceof Result))
			{
				throw new Result({'err': 1, 'mid': 0}, err);
			}
			else
			{
				throw err;
			}
		}
	)
		.then(
		function(header)
		{
			self._ipcSend(header, data);
			return header;
		}
	);
};

// return the last sent message id (exclude pass method)
Manager.prototype.getLastMessageId = function() {
	return this._mid;
};
/**
 * 注册进程中的模块
 * 
 * @param {string} proc_name -进程名称
 * @param {Array} modules -进程的模块名称集合
 */
Manager.prototype.registerModuels = function(process_name, modules)
{
	if (this._router_uri)
	{
		var data = {
			'name': process_name,
			'modules': modules
		};
		return this.request(this._router_uri+':regModule', data);
	}else {
		// no config exception
		log(12, 'Miss radon.transport.register_module Config.');
	}
};

/**
 * IPC 子进程消息收，转发处理 绑定process.js L:199
 * 
 * @param {Array} message -接收的数据消息
 * @param {Boolean} local -是否为当前进程
 */
Manager.prototype.onMessage = function(message, local)
{
	var self = this;
	var header = message[0];
	var data = local === true ? message[1] : serialize.rawDecode(message[1]);

	try
	{
		var req = null;
		if (header.type != 'ack' && header.type != 'abort')
		{
			req = new Request(self, header, data);
		}

		switch (header.type)
		{
			case 'abort':
				var trace_id = `${header.link_id}_${header.ref}`;
				global._Abort.set(trace_id, Date.now());
				break;
			case 'send':
			case 'process_cast':
				// trigger the event
				self._callbacks.onSend(req);
				break;
			case 'req':
				// reply the request mesaage
				req.delayReply();
				self._callbacks.onRequest(req)
					.then(
						function()
						{
							// send the delayed message
							req._sendDelayReply();
							// check if the req has response
							if (!req.isSent())
							{
								error.throw(
									3005,
									[
										self._process_name,
										req.getModule(),
										req.getEvent()
									]
								);
							}
						}
					)
					.catch(
						function(err)
						{
							if (err)
							{
								try
								{
									// try to send error reply
									req._error(err, true);
								}
								catch (e)
								{
									log(
										14,
										'%s: Send Error Reply Exception',
										self._process_name,
										e, err
									);
								}
							}
						}
					);
				break;
			case 'ack':
				// get a request ack message
				if (req = getRequestByMid(self, header.rid)){
					// set get Result mode
					if (req[1])
					{
						data = new Result(header, data);
					}
					(header.err ? req[3] : req[2])(data);
				}else {
					log(
						12,
						'%s: Request mesage ack miss request record (rid:%d)',
						self._process_name,
						header.rid
					);
				}
				break;
		}
	}
	catch (err)
	{
		log(14, '%s: Session::onMessage exception: %s', self._process_name, err);
		// request message we need to send back an error reply
		if (header && header.type == 'req'){
			req._error(err, true);
		}
	}
};

/**
 * IPC
 * 
 * @param {String} module_name -模块名称
 * @param {Manager} manager -{@link Manager} Manager实例 
 */
function Ipc(module_name, manager)
{
	this._manager = manager;
	this._process_name = manager.currentProcess();
	this._module_name = module_name;
}
exports.Ipc = Ipc;
/* 中断通信 */
Ipc.prototype.abort = function(target, data)
{
	target = formatHeader(target);
	target.source_module = this._module_name;

	return this._manager.abort(target, data);
};
/* 不需要响应的信息发送 */
Ipc.prototype.send = function(target, data)
{
	target = formatHeader(target);
	target.source_module = this._module_name;

	return this._manager.send(target, data);
};

/*
	进程的广播，其实还是一个消息，只是对于cluster的时候，有些操作是要广播给所有的进程。
	而cluster只能发一个进程，所以这里放一个接口和类型用于Cluster判断，广播给所有的进程。
 */
Ipc.prototype.process_cast = function(target, data)
{
	target = formatHeader(target);
	target.source_module = this._module_name;

	return this._manager.send(target, data, 'process_cast');
};
/**
 * IPC [req]类型请求
 * 
 * @param target 目标模块router
 * @param data 发送的数据
 * @param as_result 回调函数
 */
Ipc.prototype.request = function(target, data, as_result)
{
	target = formatHeader(target);
	target.source_module = this._module_name;

	return this._manager.request(target, data, as_result);
};
/**
 * 获取请求结果
 * 
 * @param {Object|String} target -目标模块
 * @param {Object} data -请求信息
 */
Ipc.prototype.requestResult = function(target, data)
{
	return this.request(target, data, true);
};
// 向连接管理模块注册链接
Ipc.prototype.registerLink = function(data)
{
	return this._manager._requestLink(
		'register',
		{
			'data': data,
			'module': this._module_name,
			'process': this._process_name
		}
	);
};
// 更新连接信息
Ipc.prototype.touchLink = function(link_id, session_id, data)
{
	return this._manager._requestLink(
		'touch',
		{
			'id': link_id,
			'session_id': session_id,
			'data': data,
			'module': this._module_name,
			'process': this._process_name
		}
	);
};
// 删除连接
Ipc.prototype.removeLink = function(link_id)
{
	return this._manager._requestLink('remove', link_id);
};
// 获取连接ID
Ipc.prototype.getLinkById = function(link_id, check_process_module)
{
	return this._manager._requestLink(
		'get',
		{
			'id': link_id,
			'exact': Boolean(check_process_module),
			'module': this._module_name,
			'process': this._process_name
		}
	);
};
// 通过token获取session
Ipc.prototype.getSessionByToken = function(token)
{
	return this._manager._requestSession('getByToken', token);
};
// 通过session ID 获取session
Ipc.prototype.getSessionById = function(id, key)
{
	var pm = this._manager._requestSession('getById', id);
	if (key)
	{
		return pm.then(
			function(session)
			{
				if (session)
				{
					return (session.data[key] || null);
				}
				return session;
			}
		);
	}
	else
	{
		return pm;
	}
};
/* 注册/新建一条会话记录 */
Ipc.prototype.registerSession = function(data)
{
	return this._manager._requestSession('register', data);
};
/* 更新一条会话记录 */
Ipc.prototype.setSession = function(id, key, value)
{
	return this._manager._requestSession(
		'update',
		{
			'id': id,
			'key': key,
			'value': value,
			'argc': arguments.length - 1
		}
	);
};
/* 新建一条会话记录 */
Ipc.prototype.createSession = function(id, key, value)
{
	return this._manager._requestSession(
		'update',
		{
			'id': id,
			'key': key,
			'value': value,
			'argc': arguments.length,
			'create': true
		}
	);
};
/* 删除一条会话记录 */
Ipc.prototype.removeSession = function(id)
{
	return this._manager._requestSession('remove', id);
};
// 更新session
Ipc.prototype.touchSession = function(id)
{
	return this._manager._requestSession('touch', id);
};

Ipc.prototype.isResult = function(obj)
{
	return (obj instanceof Result);
};

/**
 * Message Request Class
 * 
 * @param {Manager} manager -Manager实例
 * @param {Object} header -请求的头部信息
 * @param {object} data -请求数据
 */
var Rid = 0;
function Request(manager, header, data){
	this._manager = manager;
	this._header = header;
	this._data = data;
	this._reply_sent = false;
	this._delay_reply = false;
	this._reply_data = null;
	this._response_header = [];
	this._response_actions = [];
	this._is_request = (header.type == 'req');
	this._link_cache = 0;
	this._count_id = ++Rid;
}
exports.Request = Request;
/* 获取目标文件模块 */
Request.prototype.getModule = function() {
	return (this._header.module || '*');
};
/* 获取目标方法 */
Request.prototype.getEvent = function() {
	return (this._header.event || '*');
};
/* 延迟响应 */
Request.prototype.delayReply = function()
{
	this._delay_reply = true;
	return this;
};
/* 判断是否为request方式请求 */
Request.prototype.isRequest = function() {
	return this._is_request;
};
/* 判断该请求是否已响应过 */
Request.prototype.isSent = function() {
	return this._reply_sent;
};
/* 获取req头部参数 */
Request.prototype.getHeader = function(name)
{
	var header = this._header;
	if (arguments.length > 0){
		if (header.hasOwnProperty(name)){
			return header[name];
		}
		return null;
	}
	else
	{
		return header;
	}
};
// get request data param
Request.prototype.get = function(name, default_value, format)
{
	var data = this._data;
	if (arguments.length == 0)
	{
		// return all data
		return data;
	}
	else if (data && data.hasOwnProperty(name))
	{
		// todo: support format function
		return data[name];
	}
	else
	{
		return default_value;
	}
};
// 获取连接
Request.prototype.getLink = function()
{
	var self = this;
	if (self._link_cache !== 0)
	{
		return util.promiseResolve(self._link_cache);
	}

	var link_id = self.getHeader('link_id');
	if (link_id)
	{
		return self._manager._requestLink('get', {'id': link_id}).then(
			function(link)
			{
				self._link_cache = link;
				return link;
			}
		);
	}
	else
	{
		return util.promiseResolve(null);
	}
};
// 获取会话信息
Request.prototype.getSession = function(key)
{
	var session_id = this.getHeader('session_id');
	if (session_id)
	{
		return this._manager._requestSession('getById', session_id).then(
			function(session)
			{
				if (!session)
				{
					return null;
				}
				else if (key)
				{
					return (session.data[key] || null);
				}
				else
				{
					return session.data;
				}
			}
		);
	}
	else
	{
		return util.promiseResolve(null);
	}
};

Request.prototype._sendDelayReply = function()
{
	var self = this;
	if (self._delay_reply && self._reply_data)
	{
		self._delay_reply = false;
		self._reply.apply(self, self._reply_data);
		self._reply_data = null;
	}
	return self;
};
// 设置连接动作
Request.prototype._setAction = function(name, value)
{
	var self = this;
	self._response_actions.push([name, value]);

	// not request type or already sent response
	// send action now
	if (!self._is_request || self._reply_sent)
	{
		self._sendActionsToLink();
	}
};
// 通知连接管理设置动作
Request.prototype._sendActionsToLink = function()
{
	var self = this;
	var actions = self._response_actions;
	if (actions.length)
	{
		actions = actions.splice(0, actions.length);

		// no link request, put actions to headers
		var link_id = self.getHeader('link_id');
		if (!link_id)
		{
			self._response_header = self._response_header.concat(actions);
			return util.promiseResolve(false);
		}

		return self._manager._requestLink(
			'notify',
			{'id': link_id, 'actions': actions}
		).catch(
			function(result)
			{
				util.log(12, 'Notify link action fail:\n', result);
				// notify link action fail, put actions to headers
				self._response_header = self._response_header.concat(
					actions
				);
				return false;
			}
		);
	}
	else
	{
		return util.promiseResolve(true);
	}
};
/**
 * 转发该请求数据到其他目标模块
 * 
 * @param target -目标模块router
 * @param module_name -当前模块名称
 */
Request.prototype._pass = function(target, module_name)
{
	var self = this;
	target = formatHeader(target);

	// merge header
	var header = self._header;
	for (var i in header)
	{
		if (i != 'uri' && i != 'process' && i != 'module' && !target[i])
		{
			target[i] = header[i];
		}
	}

	// pass the request to another process
	// return the Promise Object for the pass result
	// if no route found will reject the Promise
	return self._sendActionsToLink().then(
		function()
		{
			var pm = self._manager.pass(target, self._data);
			if (self._is_request)
			{
				pm = pm.catch(
					function(err){
						self._error(err, false, module_name);
						throw err;
					}
				);
			}
			return pm;
		}
	);
};
/**
 * 不需要目标接口返回信息的消息发送
 */
Request.prototype._send = function(target, data, module_name)
{
	var self = this;
	target = formatHeader(target);
	copyUserHeader(self._header, target);
	target.source_module = module_name;

	return self._sendActionsToLink().then(
		function()
		{
			return self._manager.send(target, data);
		}
	);
};
/**
 * 需要目标接口返回信息的消息发送
 */
Request.prototype._request = function(target, data, as_result, module_name)
{
	var self = this;
	target = formatHeader(target);
	copyUserHeader(self._header, target);
	target.source_module = module_name;

	return self._sendActionsToLink().then(
		function()
		{
			return self._manager.request(target, data, as_result);
		}
	);
};
/* 发送给自身模块的目标接口 */
Request.prototype._self = function(method, data, as_result, module_name)
{
	var self = this;
	var target = {
		event: method
		,module: module_name
		,process: self._getProcessName()
	};

	copyUserHeader(self._header, target);
	target.source_module = module_name;

	return self._manager.request(target, data, as_result);
};

/**
 * Private reply message
 * 响应消息
 * @param  {Mix} data message result data
 */
Request.prototype._reply = function(data, module_name)
{
	var self = this;
	var header = self._header;
	var args = [header.process, header.module, header.event];

	if (!self._is_request)
	{
		error.throw(3002, args);
	}
	if (self._reply_sent)
	{
		error.throw(3004, args);
	}

	if (self._delay_reply)
	{
		self._reply_data = [data, module_name];
		return;
	}

	var res_header = {
		'source_module': module_name || header.module,
		'process': header.source_process,
		'module': header.source_module,
		'rext': header.ext,
		'rid': header.mid
	};
	copyUserHeader(header, res_header);

	if (self._response_header.length > 0)
	{
		res_header.response_header = self._response_header;
		self._response_header = [];
	}

	self._reply_sent = true;

	return self._sendActionsToLink().then(
		function()
		{
			return self._manager.send(res_header, data, 'ack');
		}
	);
};
/**
 * Private reply error message
 * @param  {Object}  err          error exception object
 * @param  {Boolean} is_exception err is an exception object
 */
Request.prototype._error = function(err, is_exception, module_name)
{
	var self = this;
	var header = self._header;
	var args = [header.process, header.module, header.event];

	if (!self._is_request)
	{
		error.throw(3003, args);
	}
	if (self._reply_sent)
	{
		error.throw(3004, args);
	}

	var res_header = {
		'source_module': module_name || header.module,
		'process': header.source_process,
		'module': header.source_module,
		'rext': header.ext,
		'rid': header.mid,
		'err': 1
	};

	if (is_exception && err instanceof Error)
	{
		if (err.radon_error)
		{
			err = {
				'success': false,
				'code': err.code,
				'message': err.message,
				'data': err.data
			};
		}
		else
		{
			err = {
				'success': false,
				'code': -1,
				'stack': err.stack.toString().split('\n'),
				'message': err.toString()
			};
		}
	}

	// clear the delay reply data
	self._reply_data = null;
	self._reply_sent = true;

	return self._sendActionsToLink().then(
		function()
		{
			return self._manager.send(res_header, err, 'ack');
		}
	);
};
// 获取当前进程名称
Request.prototype._getProcessName = function()
{
	return this._manager.currentProcess();
};


/**
 * IPC Message Response Class
 * 
 * @class
 * @param module_name -模块名称
 * @param request -Requset实例
 */
function Response(module_name, request)
{
	this._module_name = module_name;
	this._req = request;
	this._is_done = false;
	this._done_result = null;
}
exports.Response = Response;
/**
 * 转发该请求数据到其他目标模块
 * 
 * @param target -目标模块router
 * @param module_name -当前模块名称
 */
Response.prototype.pass = function(target)
{
	return this._req._pass(target, this._module_name);
};
/**
 * 不需要目标接口返回信息的消息发送
 */
Response.prototype.send = function(target, data)
{
	return this._req._send(target, data, this._module_name);
};
/**
 * 需要目标接口返回信息的消息发送
 */
Response.prototype.request = function(target, data)
{
	return this._req._request(target, data, false, this._module_name);
};
/* 发送给自身模块的目标接口 */
Response.prototype.self = function(method, data)
{
	return this._req._self(method, data, false, this._module_name);
};

Response.prototype.requestResult = function(target, data)
{
	return this._req._request(target, data, true, this._module_name);
};

Response.prototype.reply = function(data)
{
	return this._req._reply(data, this._module_name);
};

Response.prototype.setHeader = function(name, value)
{
	this._req._response_header.push([name, value]);
	return this;
};
Response.prototype.setStatusCode = function(code)
{
	return this.setHeader('RADON.HTTP_STATUS', code);
};
Response.prototype.setAction = function(name, value)
{
	this._req._setAction.apply(this._req, arguments);
	return this;
};
/* 设置cookie操作 */
Response.prototype.setCookie = function(name, value, options)
{
	if (options)
	{
		options.name = name;
		options.value = value;
	}
	else
	{
		options = {
			'name': name,
			'value': value
		};
	}
	return this.setAction('RADON.SET_COOKIE', options);
};
/**
 * 设置session
 */
Response.prototype.setSession = function(key, value)
{
	var self = this;
	var request = self._req;
	var link_id = request.getHeader('link_id');
	var session_id = request.getHeader('session_id');

	if (!link_id)
	{
		// no link_id, not client request, can't set session
		return util.promiseResolve(false);
	}

	return request._manager._requestSession(
		'update',
		{
			'id': session_id,
			'key': key,
			'value': value,
			'argc': arguments.length,
			'create': true
		}
	).then(
		function(result)
		{
			if (typeof result == 'boolean')
			{
				return result;
			}

			// created an new session
			self.setAction(
				'RADON.SET_SESSION',
				{
					'session_id': result.sid,
					'session_token': result.token
				}
			);

			if (session_id != result.sid)
			{
				// hacking the request header
				request._header.session_id = result.sid;
			}
			return true;
		}
	);
};
/**
 * 查找session
 */
Response.prototype.findSession = function(key, value)
{
	var self = this;
	var request = self._req;
	return request._manager._requestSession(
		'findSession',
		{
			//'id': session_id,
			'key': key,
			'val': value,
			'argc': arguments.length,
			'create': true
		}
	);
};

Response.prototype.error = function(err)
{
	return this._req._error(err, false, this._module_name);
};

// finish the response, block next event callback
Response.prototype.done = function(data)
{
	this._is_done = true;
	this._done_result = data;
	return this;
};

Response.prototype.isDone = function()
{
	return this._is_done;
};

Response.prototype.getDoneResult = function()
{
	return this._done_result;
};

function Result(header, data)
{
	this._header = header;
	this._data = data;
}
Result.prototype.getHeader = Request.prototype.getHeader;
Result.prototype.get = Request.prototype.get;

Result.prototype.getResponseHeader = function(name, index)
{
	var headers = this._header.response_header;
	if (headers && headers.length)
	{
		for (var i = 0; i < headers.length; i++)
		{
			if (headers[i][0] == name)
			{
				if (index > 0)
				{
					index--;
				}
				else
				{
					return headers[i][1];
				}
			}
		}
	}

	return name ? null : headers;
};

/**
 * @class 事件触发类
 * 
 * #.*.beforeAction
 * #.MOD.beforeAction
 * *.eventName
 * MOD.eventName
 * *.*
 * MOD.*
 * 
 */
function Trigger(){
	this._events = new Map();
}
exports.Trigger = Trigger;

/**
 * 监听事件
 * 
 * @param {string} 		name -事件名称
 * @param {function} 	callback -回调函数
 * @param {string} 		gid -模块标识 暂时为模块名称
 */
Trigger.prototype.on = function(name, callback, gid) {
	var events = this._events;

	if (events.has(name)){
		events.get(name).push([gid, callback]);
	}else {
		events.set(name, [[gid, callback]]);
	}
	return this;
};
/**
 * 取消监听事件
 * 
 * @param {string} 		name -事件名称
 * @param {function} 	fn -回调函数
 * @param {string} 		gid -模块标识 暂时为模块名称
 */
Trigger.prototype.off = function(name, fn, gid){
	var events = this._events;
	if (name){
		if (events.has(name))
		{
			if (arguments.length == 1 ||
				pruneCallbacks(events.get(name), fn, gid))
			{
				events.delete(name);
			}
		}
	}else {
		for (name of events)
		{
			if (pruneCallbacks(name[1], fn, gid))
			{
				events.delete(name[0]);
			}
		}
	}

	return this;
}
/**
 * 触发监听事件
 * 
 * @param {string} 		name -事件名称
 */
Trigger.prototype.emit = function *(name) {
	var cbs = this._events.get(name);
	var args = Array.prototype.slice.call(arguments, 1);
	var count = 0;

	if (cbs)
	{
		var cb, data;
		while (cb = cbs[count])
		{
			count++;
			data = yield cb[1].apply(cb, args);
			if (data === true)
			{
				return -count;
			}
		}
	}

	return count;
};
/**
 * 遍历监听的事件，删除对应的监听函数
 */
function pruneCallbacks(cbs, fn, gid)
{
	if (typeof fn != 'function'){
		gid = fn;
		fn = null;
	}
	for (var i = cbs.length; i --> 0;){
		if ((gid && cbs[i][0] !== gid) || (fn && cbs[i][1] !== fn)){
			continue;
		}
		cbs.splice(i, 1);
	}
	return (cbs.length == 0);
}

/**
 * 
 * 解析头部字符串 
 * 格式: [#] module{group}@process:event
 * 
 * @param {string} header -头字符串
 */
var messageUriRegx = /^([^\{@:]+)?(?:\{([^\}]+)\})?(?:@([^:]+))?(?:\:(.+))?$/;
function formatHeader(header) {
	if (typeof header == 'string')
	{
		if (header[0] == '#'){
			header = {'uri': header.slice(1)};
		}else {
			var match = messageUriRegx.exec(header);
			header = {};
			if (match){
				if (match[1]){
					header.module = match[1];
				}
				if (match[2]){
					header.group = match[2];
				}
				if (match[3]){
					header.process = match[3];
				}
				if (match[4]){
					header.event = match[4];
				}
			}
		}
	}

	return header;
};

function copyUserHeader(origin, target)
{
	if (origin.session_id)
	{
		target.session_id = origin.session_id;
	}
	if (origin.link_id)
	{
		target.link_id = origin.link_id;
	}
	if (origin.ref)
	{
		target.ref = origin.ref;
	}
	if(origin.cookie)
	{
		target.cookie = origin.cookie;
	}
	if(origin.extraField)
	{
		target.extraField = origin.extraField;
	}
	if(origin.event)
	{
		target.origin_event = origin.event;
	}
}

// checking the request's timeout
// 启动请求超时检查纤程
function checkRequestTimeout(){
	var self = this;
	var now = Date.now();
	var err = error.getError(3304);
	var req;

	for (req of self._requests)
	{
		if (now > req[1][0])
		{
			// request timeout
			self._requests.delete(req[0]);

			// trigger timeout error
			if (req[1][1])
			{
				// need result data
				req[1][3](new Result({'mid':0, 'err':1}, err));
			}
			else
			{
				req[1][3](err);
			}
		}
	}
}

// 使用消息 ID 获取请求队列中的对象
function getRequestByMid(self, mid){
	var list = self._requests;
	var req = list.get(mid);
	if (req)
	{
		list.delete(mid);
		return req;
	}

	return null;
}
