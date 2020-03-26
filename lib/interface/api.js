/**
 * Radon HTTP Api Interface
 * ------------------
 * log level: 20 - core module
 */
/**
 * @file radon API处理模块
 */
"use strict";

var http        = require('http');
var fs 			= require('fs');
var path		= require('path');
var fileType	= require('file-type');
var querystring = require('querystring');
var base        = require('../core/base');
var util        = require('../core/util');
var LinkClient  = require('../core/link_client');
var serialize   = require('../core/serialize');
var CONST       = require('../core/const');
var fileService = require('../modules/file_service');
var LOG_FILE_PATH;
var mod = base.Class.extend({
	init: function(config, ipc, last, tran)
	{
		var self = this;
		self._ipc		= ipc;

		// module status
		self._request_count = 0;
		self._status = false;
		self._transaction = tran;

		// api 模块监听的路径
		self._path			= config.path || false;
		self._path_length	= (self._path ? self._path.length : 0);
		self._strip_path	= config.strip_path || false;
		// api 模块消息 uri 参数的前序, 避免系统消息冲突
		self._uri_prefix	= config.prefix || '';
		// 连接标示 cookie 参数名称
		self._link_cookie	= config.link_cookie || 'RADON_LINKID';
		// 连接会话标识 cookie 参数名称
		self._sess_cookie	= config.sess_cookie || false;
		// cookie 默认参数
		self._cookie_option = config.cookie_option || {};

		//临时文件 存放位置
		self._upload_path	= config.upload_path || require('os').tmpdir();

		//是否使用文件服务
		self._files_service_config = config.files_service || {};

		// max request post size, default 20 MB
		self._max_post_size = config.max_post_size || 20 * 1024 * 1024;

		// 按照配置信息创建服务器实例对象
		self._listen = config.listen;

		// 不写socket日志文件
		self._no_log_request = config.no_log_request;

		LOG_FILE_PATH = config.log_file || util.normalizePath('/../var/log/socket_');

		if (last)
		{
			if (config.no_link || last._listen != self._listen)
			{
				// listen change, free last server
				last.free();
			}
			else
			{
				// use last server instance
				self._server = last._server;
				self._links = last._links;

				// unbind the old event
				self._server.removeAllListeners();
			}
		}

		// 连接列表记录
		if (config.no_link)
		{
			self._links = false;
		}
		else
		{
			if (!self._links)
			{
				self._links = new LinkClient(
					ipc,
					{
						'timeout': (config.link_timeout || 600),
						'touchtime': (config.link_touch_time || 60),
						'interval': (config.link_interval || 50),
						'prefix': ipc.id,
						'module': config.name
					}
				);
			}
		}

		if (!self._server)
		{
			// no server, create new one
			self._server = http.createServer();
			self._server.listen.apply(
				self._server,
				util.formatNetAddress(self._listen, true)
			);
		}

		// bind the server event;
		self._server.setTimeout((config.request_timeout || 120) * 1000);
		self._server.on(
			'error',
			function(err)
			{
				util.log(24, 'Static HTTP Server error:', err);
			}
		)
		.on(
			'request',
			function (req, res){
				// check if module unloading
				if (self._status)
				{
					res.writeHead(
						500,
						'SERVER_RESTARTING',
						{'Connection': 'close'}
					);
					res.end();
				}
				else
				{
					self._transaction.enter();
					self.onRequest(req, res).then(
						self._transaction.leave,
						self._transaction.leave
					);
				}
			}
		);

		util.log(
			21, 'HTTP API Server (%s) listen on %s',
			self._path,
			self._listen
		);
	},
	// free the resource
	free: function()
	{
		if (this._server)
		{
			this._server.close();
			this._server = null;
		}
	},
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
	getEvents: function()
	{
		var evts = [];
		if (this._links)
		{
			evts.push(this._links.getNotifyEvent());
		}
		return evts;
	},

	// HTTP请求处理函数
	onRequest: util.generator(function *(req, res)
	{
		var self  = this;
		var files = [];
		var uri = req.url;

		// 判断是否为对应的http uri请求
		if (self._path && uri.indexOf(self._path) !== 0)
		{
			// 返回404错误代码
			res.writeHead(404, 'API NotFound', {'Connection': 'close'});
			res.end('API NotFound');
			return;
		}

		if (req.headers['content-length'] > self._max_post_size)
		{
			res.writeHead(500, 'CONTENT_ERROR', {'Connection': 'close'});
			res.end('Content Size Exceed!');
			return;
		}

		// 记录http请求url
		var logMessage = {
			'type': 'http request begin',
			'uri': uri,
			'message_id': Date.now()
		};
		if (!self._no_log_request) {
			logRequest(logMessage);
		}

		if (self._strip_path && self._path_length){
			uri = uri.slice(self._path_length);
		}
		var pos = uri.indexOf('?');
		var link_id = 0;
		var sess_id = 0;
		var response_cookies = new Map();
		var param = {
			'method': req.method,
			'uri': ~pos ? uri.slice(0, pos) : uri,
			'get': ~pos ? querystring.parse(uri.slice(pos+1)) : {},
			'post': null,
			'files': null,
			'cookie': parseCookie(req.headers['cookie']),
			'header': req.headers
		};

		// parse accept format
		var response_type = 'text';
		var accept = req.headers.accept || '';
		if (~accept.indexOf('application/json'))
		{
			response_type = 'json';
		}
		else if (~accept.indexOf('application/serialize'))
		{
			response_type = 'serialize';
		}

		try
		{
			// process http request post data
			if (param.method === 'POST' || param.method === 'PUT')
			{
				let ct = req.headers['content-type'] || '';
				let reader = SizeLimitStream({'max_size': self._max_post_size});

				if (~ct.indexOf('multipart/form-data'))
				{
					reader = FormParser(
						{
							'max_size': self._max_post_size,
							'file_path': self._upload_path,
							'boundary': ct
						}
					);
				}
				else if (~ct.indexOf('application/json'))
				{
					reader.setFormater(JSON.parse);
				}
				else if (~ct.indexOf('application/serialize'))
				{
					reader.setFormater(serialize.decode);
				}
				else if (~ct.indexOf('text/xml'))
				{
					reader.setFormater(String);
				}
				else
				{
					reader.setFormater(querystring.parse);
				}

				param.post = yield new Promise(function(done, fail){
					reader
						.on('files', function(files){
							param.files = files;
						})
						.on('result', done)
						.on('error', fail);

					req.pipe(reader);
				});

				// xss字符检查
				util.xssCheck(param.get, param.uri, 'get');
				util.xssCheck(param.post, param.uri, 'post');

				//上传文件到文件服务
				if (self._files_service_config && self._files_service_config.enable &&　param.files.length) {
					let fileServiceConfig = self._files_service_config;
					for(let i = 0 ; i < param.files.length; i++) {
						let file = param.files[i];
						let dstFileName = fileServiceConfig.machine_id + path.basename(file.tmpFile);
						let config = {
							host: fileServiceConfig.host,
							port: fileServiceConfig.port,
							write_url: fileServiceConfig.write_url,
							path:  path.join(fileServiceConfig.temp_path, fileServiceConfig.project_name, dstFileName),
						};
						let result = yield fileService.write(file.tmpFile, config);
						file.tmpFile = result.path;
					}
				}
				// 删除秒传操作。不需要。
				//if(param.files && param.files.length)
				//{
				//	for(let i = 0; i < param.files.length; i++)
				//	{
				//		let tmpFile = param.files[i].tmpFile;
				//		let content = fs.readFileSync(tmpFile);
				//		let name = util.md5(String(content));
				//		let dir = name.substr(0, 2);
				//		dir = `${self._upload_path}${dir}/`.replace(/[\/\\][^\/\\]*$/, '');
				//		if (!fs.existsSync(dir))
				//		{
				//			fs.mkdirSync(dir);
				//		}

				//		let src = fs.createReadStream(tmpFile);
				//		let dst = fs.createWriteStream(`${dir}/${name}`);
				//		yield util.promise(function(done, fail) {
				//			src.once('end', done);
				//			src.once('error', fail);
				//			dst.once('error', fail);
				//			src.pipe(dst);
				//		});
				//	}
				//}
			}

			// after form parsed, save form, process link
			if (self._links)
			{
				// 判断 link_id 的 cookie 参数,
				// 获取 link_id 或者 创建新 link_id
				link_id = param.cookie[self._link_cookie];
				if (Array.isArray(link_id))
				{
					link_id = link_id.pop();
				}

				let link = self._links.get(link_id);
				if (link)
				{
					// 更新连接记录
					self._links.touch(link_id);
				}
				else
				{
					// 创建连接记录
					link = {
						'headers': null,
						'cookies': {}
					};

					link_id = yield self._links.create(link);
					response_cookies.set(
						self._link_cookie,
						link_id
					);
				}

				// process session data
				if (self._sess_cookie)
				{
					// 判断是否有 session_token, 有则获取对应 session_id
					let sess_token = param.cookie[self._sess_cookie];
					if (sess_token)
					{
						if (Array.isArray(sess_token))
						{
							sess_token = sess_token.pop();
						}

						sess_id = yield self._links.getSessionId(
							link_id,
							sess_token
						);
					}
				}
			}

			// send request to module
			let result = yield self._ipc.requestResult(
				{
					'uri': self._uri_prefix + uri,
					'http': true,
					'link_id': link_id,
					'cookie': param.cookie || {},
					'session_id': sess_id
				},
				param
			);

			// module request reply, process call back result
			// process push header
			processActions.call(
				self, res, result, link_id, response_cookies
			);

			// process resoonse content
			var data = result.get();

			switch (response_type)
			{
				case 'json':
					res.end(JSON.stringify(data));
					break;
				case 'serialize':
					res.end(serialize.encode(data));
					break;
				default: // text
					if ('string' == typeof data || Buffer.isBuffer(data))
					{
						res.end(data);
					}
					else
					{
						switch (result.getResponseHeader('content-type'))
						{
							case 'application/json;charset=utf-8':
							case 'application/json':
								res.end(JSON.stringify(data));
								break;
							case 'application/serialize':
								res.end(serialize.encode(data));
								break;
							default:
								res.end(''+data);
								break;
						}
					}
					break;
			}

			// process temp file, remove unused file
			cleanTempUploadFile.call(param);
		}

		// process error
		catch (error)
		{
			try
			{
				// process response actions
				processActions.call(
					self, res, error, link_id, response_cookies
				);
				res.writeHead(
					500,
					'REQUEST_ERROR',
					{'Connection': 'close'}
				);

				// process temp file, remove unused file
				cleanTempUploadFile.call(param);
			}
			catch (err) {
				util.log(24, 'Process Error Response Error:\n', err);
			}

			if (self._ipc.isResult(error))
			{
				error = error.get();
			}
			else if (error instanceof Error)
			{
				error = {
					'success': false,
					'code': error.code || -1,
					'message': error.message,
					'stack': error.stack.toString().split('\n')
				};
			}

			util.log(24, 'Process HTTP API Request ERROR:\n', error);

			if (error.stack && param.cookie.debug != 10086)
			{
				delete error.stack;
			}

			switch (response_type)
			{
				case 'json':
					res.end(JSON.stringify(error));
					break;
				case 'serialize':
					res.end(serialize.encode(error));
					break;
				default: // text
					res.end(JSON.stringify(error));
					break;
			}
		}

		// 记录返回的http请求
		logMessage['type'] = 'http response end';
		if (!self._no_log_request) {
			logRequest(logMessage);
		}
	})
});
module.exports = mod;

/* 记录请求日志信息 */
var old = util.date('Ymd', new Date());
function logRequest(message)
{
	try
	{
		var msg = JSON.stringify(message) + '\n';
	}
	catch (e)
	{
		msg = message;
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
/* 解析cookie信息 */
function parseCookie(cookie_string)
{
	if (cookie_string)
	{
		return querystring.parse(cookie_string, '; ');
	}
	else
	{
		return {};
	}
}

// 设置Cookie辅助函数
function setCookie(res, opts, cookies)
{
	var param;
	var name;
	var val;
	var values = [];
	for (val of cookies)
	{
		name = val[0];
		val = val[1];
		if (typeof val == 'object')
		{
			if (val === null || val.value === null)
			{
				// remove cookie, set value to null
				val = {'name': name, 'value':'-', expires: -1};
			}
			param = formatCookieParam(val, opts);
		}
		else
		{
			param = formatCookieParam({'name': name, 'value': val}, opts);
		}

		values.push(param);
	}

	// merge old cookie value and set cookie
	param = res.getHeader('Set-Cookie');
	if (param)
	{
		if (Array.isArray(param))
		{
			values = param.concat(values);
		}
		else
		{
			values.unshift(param);
		}
	}
	return res.setHeader('Set-Cookie', values);
}
/**
 * Link_client连接动作处理
 * 相关模块 transport#Request|Respone link_client#onNotify|getActions
 * 
 * @param {*} res web server response对象
 * @param {*} result 匹配的模块接口返回的结果数据
 * @param {*} link_id 连接ID
 * @param {*} cookies cookie
 */
function processActions(res, result, link_id, cookies)
{
	var self = this;

	// get link actions data
	var actions = self._links ? self._links.getActions(link_id) : [];

	// process request result header ans http status
	if (self._ipc.isResult(result))
	{
		var headers = result.getHeader('response_header');
		actions = headers ? actions.concat(headers) : actions;
	}

	var status = 0;
	var act;
	for (var i = 0; i < actions.length; i++)
	{
		act = actions[i];
		switch (act[0])
		{
			case 'RADON.SET_COOKIE':
				cookies.set(act[1].name, act[1]);
				break;
			case 'RADON.HTTP_STATUS':
				status = act[1];
				break;
			case 'RADON.SET_SESSION':
				if (self._links)
				{
					self._links.setSession(
						link_id,
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
				}
				break;
			default:
				res.setHeader.apply(res, act);
				break;
		}
	}
	if (cookies.size)
	{
		setCookie(res, self._cookie_option, cookies);
	}
	if (status)
	{
		res.writeHead(status);
	}
}

// 删除请求临时上传的文件
function cleanTempUploadFile()
{
	if (this.files)
	{
		var file;
		for (var i = this.files.length; i --> 0;)
		{
			file = this.files[i];
			if (fs.existsSync(file.tmpFile))
			{
				// tmp file exists, remove it
				fs.unlink(file.tmpFile);
			}
		}
	}
}

var delete_date  = new Date(0);
var cookie_props = [
	'name', 'value', 'domain', 'path',
	'expires', 'httpOnly', 'secure'
];
var code_props = new Set(['name', 'value']);
/* 格式化cookie参数 */
function formatCookieParam(param, def)
{
	var opts = {};
	for (var prop in cookie_props)
	{
		prop = cookie_props[prop];
		if (param.hasOwnProperty(prop) && param[prop] !== undefined)
		{
			opts[prop] = code_props.has(prop) ?
				encodeURIComponent(param[prop]) : param[prop];
		}
		else if (def.hasOwnProperty(prop) && def[prop] !== undefined)
		{
			opts[prop] = code_props.has(prop) ?
				encodeURIComponent(def[prop]) : def[prop];
		}
	}
	if (opts.hasOwnProperty('expires'))
	{
		if (opts.expires === -1)
		{
			opts.expires = delete_date;
		}
		else if (!(opts.expires instanceof Date))
		{
			opts.expires = new Date(opts.expires);
		}
	}

	var text = opts.name + '=' + opts.value;
	// expires
	if (opts.expires)
	{
		text += '; expires=' + opts.expires.toUTCString();
	}
	// domain
	if (opts.domain)
	{
		text += '; domain=' + opts.domain;
	}
	// path
	if (opts.path)
	{
		text += '; path=' + opts.path;
	}
	// secure
	if (opts.secure)
	{
		text += '; secure';
	}
	// httpOnly
	if (opts.httpOnly)
	{
		text += '; HttpOnly';
	}
	return text;
}

var sys_util = require('util');
var Transform = require('stream').Transform;

/**
 * 带有尺寸限制的功能的转换流
 * 
 * @class
 * @extends Transform
 */
function SizeLimitStream(options)
{
	if (!(this instanceof SizeLimitStream))
	{
		return new SizeLimitStream(options);
	}

	Transform.call(this, options);
	this._buf = [];
	this._size = 0;
	this._max = options && options.max_size || 0;
	this._format = options && options.formater || null;
}
sys_util.inherits(SizeLimitStream, Transform);
/* Transform流_transform实现 */
SizeLimitStream.prototype._transform = function(chunk, encoding, done)
{
	this._size += chunk.length;
	if (this._max && this._max < this._size)
	{
		// overflow size, free the buffer
		this._buf = [];
		done('Size Overflow');
	}
	else
	{
		this._buf.push(chunk);
		done();
	}
};
/* Transform流_flush实现 */
SizeLimitStream.prototype._flush = function(done)
{
	var data = Buffer.concat(this._buf);
	this._buf = [];
	try
	{
		if (this._format)
		{
			this.emit('result', this._format(data.toString()));
		}
		else
		{
			this.push(data);
		}
		done();
	}
	catch (err)
	{
		done(err);
	}
};
/* 设置格式化函数 */
SizeLimitStream.prototype.setFormater = function(callback)
{
	this._format = callback;
};

/**
 * 解析 multipart/form-data格式转换流类
 * 
 * @class
 * @extends Transform
 * 
 */
var FILE_HEADER_SIZE = 262;
function FormParser(options)
{
	if (!(this instanceof FormParser))
	{
		return new FormParser(options);
	}

	Transform.call(this, options);

	this._buf = null;
	this._stat = 0;
	this._size = 0;
	this._max = options && options.max_size || 0;
	this._file_path = options && options.file_path ||
		require('os').tmpdir() + '/';

	// check path exists
	var dir = this._file_path.replace(/[\/\\][^\/\\]*$/, '');
	if (!fs.existsSync(dir))
	{
		fs.mkdirSync(dir);
	}

	// process boundary mark
	var bound = options && options.boundary;
	var ms;
	if (!bound)
	{
		throw new Error('missing form-data boundary');
	}
	if (ms = bound.match(/boundary=([^ ]+)/))
	{
		bound = ms[1];
	}
	this._boundary = '--' + bound + '\r\n';
	this._boundary_end = '--' + bound + '--\r\n';

	this._headers = null;
	this._data = null;
	this._file = null;
	this._wait_file = 0;
	this._flush_done = null;

	this._result_field = {};
	this._result_file = [];
}
sys_util.inherits(FormParser, Transform);

FormParser.prototype._transform = function(chunk, encoding, done)
{
	var self = this;
	self._size += chunk.length;
	if (self._max && self._max < self._size)
	{
		// overflow size, free the buffer
		self._buf = null;
		done('Size Overflow');
	}

	var buf = self._buf;
	var start = 0;
	var line;
	for (var i = 0; i < chunk.length;)
	{
		if (chunk[i++] == 13 && chunk[i] == 10)
		{
			// found line end
			line = chunk.slice(start, ++i);
			start = i;
			if (buf)
			{
				line = Buffer.concat([buf, line]);
				buf = null;
			}
			if (self._on_line(line, done))
			{
				return;
			}
			line = null;
		}
	}

	// save the left data
	if (start < chunk.length)
	{
		if (start)
		{
			chunk = chunk.slice(start);
		}
		self._buf = buf ? Buffer.concat([buf, chunk]) : chunk;
	}
	else
	{
		self._buf = null;
	}

	done();
};

FormParser.prototype._on_line = function(line, done)
{

	var self = this;
	var bs = self._boundary;
	var be = self._boundary_end;
	var headers = self._headers;

	switch (self._stat)
	{
		case 0:
			// at first start
			if (line.toString() == bs)
			{
				self._stat = 1;
				return;
			}
			break;

		case 1:
			// at part header
			if (line.length != 2)
			{
				// process header line
				line = line.toString();
				switch (0)
				{
					case line.indexOf('Content-Disposition: form-data;'):
						if (headers)
						{
							// we should has only one disposition header
							break;
						}
						self._headers = headers = querystring.parse(
							line.slice(31).trim(),
							'; '
						);
						for (line in headers)
						{
							headers[line] = headers[line].slice(1, -1);
						}
						return;

					case line.indexOf('Content-Type:'):
						// we should has the disposition header first
						if (headers)
						{
							headers.contentType = line.slice(13).trim();
							return;
						}
						break;

					default:
						if (line == bs || line == be || !headers)
						{
							// should not has tag string, and must has headers
							break;
						}
						return;
				}
			}
			else
			{
				// empty line, end part header
				if (headers && headers.name !== undefined)
				{
					if (headers.filename && headers.contentType)
					{
						// is a file field, create the file stream
						var tmp_file;
						do
						{
							tmp_file = self._file_path +
								Date.now().toString(36) +
								Math.round(1000 * Math.random()).toString(36);
						}
						while (fs.existsSync(tmp_file));

						self._file = {
							'name': headers.name,
							'tmpFile': tmp_file,
							'fileName': headers.filename,
							'contentType': headers.contentType,
							'size': 0,
							'header': new Buffer(FILE_HEADER_SIZE),
							'stream': fs.createWriteStream(tmp_file)
						};
						self._file.stream.on(
							'error',
							self.emit.bind(self, 'error')
						);
					}

					// next step, process content
					self._stat = 2;
					return;
				}
			}
			break;

		case 2:
			// at part body
			var file = self._file;
			var len = line.length;
			if (len == bs.length && line.toString() == bs)
			{
				self._stat = 1; // end part
			}
			else if (len == be.length && line.toString() == be)
			{
				self._stat = 3; // end parse
			}
			else
			{
				// part data, save to value
				if (file)
				{
					// copy line to the file header buffer
					if (file.size < FILE_HEADER_SIZE)
					{
						line.copy(file.header, file.size);
					}

					// process file upload
					if (self._data)
					{
						// write the last line to stream
						file.stream.write(self._data);
					}
					// cache current line to the data
					self._data = line;
					file.size += line.length;
				}
				else
				{
					if (self._data)
					{
						self._data.push(line);
					}
					else
					{
						self._data = [line];
					}
				}
				return;
			}

			// process end part
			if (self._data)
			{
				if (file)
				{
					file.size -= 2;
					self._wait_file++;
					file.stream.end(
						self._data.slice(0, -2)
					);

					file.stream.on('finish', self._on_file_done.bind(self));

					delete file.stream;

					// process file content type
					if (file.size < FILE_HEADER_SIZE)
					{
						file.header.fill(0, file.size);
					}
					file.type = fileType(file.header);
					delete file.header;

					self._result_file.push(file);
					self._file = null;
				}
				else
				{
					line = Buffer.concat(self._data);
					self._result_field[headers.name] =
						line.slice(0, -2).toString();
				}
				self._data = null;
				self._headers = null;
				return;
			}
			// should has data value, format error
			self._stat = -1; // parse error
			break;
	}
	done(new Error('Error multipart/form-data Format'));
	return true;
};

FormParser.prototype._on_file_done = function()
{
	var self = this;
	if (--self._wait_file === 0 && self._flush_done)
	{
		self._flush_result();
		self._flush_done();
	}
};

FormParser.prototype._flush_result = function()
{
	var self = this;
	if (self._result_file.length)
	{
		self.emit('files', self._result_file);
	}
	self.emit('result', self._result_field);
};

FormParser.prototype._flush = function(done)
{
	var self = this;
	if (self._buf)
	{
		var buf = self._buf;
		self._buf = null;
		if (self._on_line(Buffer.concat([buf, Buffer('\r\n')]), done))
		{
			return;
		}
	}
	if (self._stat === 3)
	{
		if (self._wait_file > 0)
		{
			self._flush_done = done;
		}
		else
		{
			self._flush_result();
			done();
		}
	}
	else
	{
		done(new Error('Error multipart/form-data Format'));
	}
};