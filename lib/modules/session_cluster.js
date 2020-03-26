/**
 * Radon Session Cluster Module
 * ----------------------------------------
 * manager session data
 * log level: 20 - core module
 */

"use strict";

let base = require('../core/base');
let util = require('../core/util');
const Redis = require('ioredis');

module.exports = base.Class.extend({
	init: function(config, ipc, last)
	{
		let self = this;
		self._ipc = ipc;
		// session token string prefix size
		self._token_size = config.token_size || 30;
		self._ready = false;
		self._storage = new Storage(config.storage, self);
		// loading session, delay calls
		self._queue = [];
		self._storage.init()
			.then(
				() => self._ready = true,
				(error) => {
					util.log(
						24, 'Init Session Error:\n%s',
						error.stack || error
					);
				})
			.then(
				() => {
					while (self._queue.length)
					{
						(self._queue.shift())();
					}
				}
			)
	},
	getEvents: function()
	{
		return [
			['register', this.register],
			['touch', this.touch],
			['update', this.update],
			['remove', this.remove],
			['getByToken', this.getByToken],
			['findSession', this.findSession],
			['listSessions', this.listSessions],
			['getById', this.getById]
		];
	},

	beforeAction: function(req, res)
	{
		let self = this;
		if (!self._ready)
		{
			// session data not ready,
			// wait for the loading process
			return util.promise(
				function(done)
				{
					if (self._ready)
					{
						done();
					}
					else
					{
						self._queue.push(done);
					}
				}
			);
		}
	},

	// register link
	register: function*(req, res)
	{
		let self = this;
		let id = yield this._storage.getIncrId();

		let session = {
			'sid': id,
			'token': util.token(self._token_size) + id,
			'time': Date.now(),
			'data': req.get()
		};

		// write to ram data
		yield self._storage.set(id, session);
		return session;
	},

	// touch link item, keep link alive
	touch: function*(req, res)
	{
		let self = this;
		let session = yield self._storage.get(req.get());
		if (session)
		{
			session.time = Date.now();
			yield self._storage.update(session);
			return true;
		}
		
		return false;
	},

	// touch link item, keep link alive
	update: function*(req, res)
	{
		let self = this;
		let id = req.get('id');
		let key = req.get('key');
		let value = req.get('value');
		let argc = req.get('argc');
		let session = yield self._storage.get(id);

		if (session)
		{
			if (argc > 1)
			{
				session.data[key] = value;
			}
			else
			{
				session.data = key;
			}
			
			session.time = Date.now();

			yield self._storage.update(session);
			
			return true;
		}
		else if (req.get('create') === true)
		{
			let data;
			if (argc > 1)
			{
				data = {};
				data[key] = value;
			}
			else
			{
				data = key;
			}
			if (id <= 0)
			{
				id = yield self._storage.getIncrId();
			}
			
			let session = {
				'sid': id,
				'token': util.token(self._token_size) + id,
				'time': Date.now(),
				'data': data
			};

			// write to static storage
			yield self._storage.update(session);

			return session;
		}
		else
		{
			return false;
		}
	},

	// remove a link
	remove: function*(req, res)
	{
		let self = this;
		let id = req.get();
		
		return !!(yield self._storage.remove(id));
	},

	// get session by session_id
	getById: function*(req, res)
	{
		let self = this;
		let id = req.get();
		return id ? self._storage.get(id) : null;
	},

	// 通过token查找出session信息
	getByToken: function*(req, res)
	{
		let self = this;
		let token = req.get();
		let session = null;
		
		if (token)
		{
			session = yield self._storage.find('token', token);
		}

		return session;
	},
	findSession: function*(req, res)
	{
		let key = req.get('key');
		let value = req.get('val');
		let ret = [];
		let sessions = yield this._storage.getAll();
		for (let s of sessions)
		{
			if(util.getProp(s.data, key) === value) {
				ret.push(s);
			}
		}

		return ret;
	},
});

/**
 * @class Session Storage Module
 * ------------------------
 * Manager the static session data to the storage
 */
function Storage(config)
{
	let self = this;
	// 引擎类型
	self._type = config.type || 'redis';
	self._connection = config.connection;
	self._name_space = config.name_space;
	self._save_interval = (config.save_interval || 60) * 1000;
	self._busy = false;
	self._load_id = 0;

	switch (self._type){
		case 'redis':
			break;
	}
}

/*
 * 获取命名空间内的自增ID
 */
Storage.prototype.getIncrId = function *() {
	return yield this.client.incr(this._name_space + ':' + 'increment');
};

/**
 * 根据sid找出对应的session
 */
Storage.prototype.get = function *(sid) {
	let ret = null;
	try {
		let data = yield this.client.hget(this._name_space, sid);
		if(data) {
			ret = JSON.parse(data);
		}
	}
	catch (e) {
		util.log(104, `Get 读取Redis错误 ${JSON.stringify(e)}`);
	}
	
	return ret;
};

/**
 *	根据字段值找出某一个相同的值，并返回session
 */
Storage.prototype.find = function *(f, v) {
	let ret = null;
	try {
		let data = yield this.client.hgetall(this._name_space);
		if(data) {
			Object.keys(data).some(key => {
				try {
					if(data[key]) {
						let item = JSON.parse(data[key]);
						if(item[f] === v) {
							ret = item;
							return true;
						}
					}
				}
				catch (e) {
					util.log(104, `Redis Parse Data Error ${data[key]}`);
				}
			});
		}
	}
	catch (e) {
		util.log(104, `Find 读取Redis错误 ${JSON.stringify(e)}`);
	}
	
	return ret;
};

/**	
 * 得出全部的session
 */
Storage.prototype.getAll = function *() {
	let ret = [];
	try {
		let data = yield this.client.hgetall(this._name_space);
		if(data) {
			Object.keys(data).forEach(key => {
				try {
					if(data[key]) {
						let item = JSON.parse(data[key]);
						ret.push(item);
					}
				}
				catch (e) {
					util.log(104, `GetAll Redis Parse Data Error ${data[key]}`);
				}
			});
		}
	}
	catch (e) {
		util.log(104, `GetAll 读取Redis错误 ${JSON.stringify(e)}`);
	}
	
	return ret;
};
// 初始化连接redis
Storage.prototype.init = function () {
	let self = this;
	return util.promise(function (done, fail) {
		switch (self._type)
		{
			case 'redis':
				self.client = new Redis.Cluster(self._connection, {
					enableReadyCheck: true,
                    enableOfflineQueue: false,
				});
				
				self.client
					.on('error', (e) => {
						util.log(24, `Redis Error: ${JSON.stringify(e)}`);
					})
					.on('ready', () => {
						util.log(21, `Connect Redis Success Ready`);
						done();
					});
				break;
			default:
				fail("Only Support Redis Cluster");
				break;
		}
		
	});
};

// 更新某一条会话记录
Storage.prototype.update = function*(session)
{
	let self = this;

	switch (self._type)
	{
		case 'redis':
			try {
				yield this.client.hset(this._name_space, session.sid, JSON.stringify(session));
				return true;
			}
			catch (e) {
				util.log(24, `Update Redis Error`);
			}
			
			break;
	}
	
	return false;
};
// 删除某一条会话记录
Storage.prototype.remove = function*(session_id)
{
	let self = this;
	switch (self._type){
		case 'redis':
			try {
				return yield this.client.hdel(this._name_space, session_id);
			}
			catch (e) {
				util.log(24, `Update Redis Error`);
			}
			
			break;
	}
	
	return false;
};