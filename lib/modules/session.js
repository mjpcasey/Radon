/**
 * Radon Session Module
 * ----------------------------------------
 * manager session data
 * log level: 20 - core module
 */

"use strict";

var base = require('../core/base');
var util = require('../core/util');

module.exports = base.Class.extend({
	init: function(config, ipc, last)
	{
		var self = this;
		self._ipc = ipc;
		// session expire time, default: 30 mins
		self._timeout = (config.timeout || 1800) * 1000;
		// session token string prefix size
		self._token_size = config.token_size || 30;

		if (last)
		{
			self._storage = last._storage;
			self._id = last._id;
			self._sessions = last._sessions;
			clearInterval(last._tid);
		}
		else
		{
			// static session storage object
			self._storage = new Storage(config.storage, self);
			// loading session, delay calls
			self._queue = [];
			self._id = 0;
			self._sessions = null;
			self._storage.load(Date.now() - self._timeout).then(
				function(sessions)
				{
					self._sessions = sessions;
					self._id = self._storage._load_id + 1;
				},
				function(error)
				{
					util.log(
						24, 'Load Session Error:\n%s',
						error.stack || error
					);
					self._sessions = new Map();
				}
			).then(function(){
				while (self._queue.length)
				{
					(self._queue.shift())();
				}
				self._tid = setInterval(
					checkDataTimeout.bind(self),
					self._timeout
				);
			});
		}
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

	unload: function(status, tran)
	{
		tran.enter();
		this._storage.save()
			.then(tran.leave, tran.leave);
	},

	beforeAction: function(req, res)
	{
		var self = this;
		if (!self._sessions)
		{
			// session data not ready,
			// wait for the loading process
			return util.promise(
				function(done)
				{
					if (self._sessions)
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
	register: function(req, res)
	{
		var self = this;
		var id = ++self._id;

		var session = {
			'sid': id,
			'token': util.token(self._token_size) + id,
			'time': Date.now(),
			'data': req.get()
		};

		// write to ram data
		self._sessions.set(id, session);

		// write to static storage
		if (self._storage){
			self._storage.update(session);
		}

		res.done(session);
	},

	// touch link item, keep link alive
	touch: function(req, res)
	{
		var self = this;
		var session = self._sessions.get(req.get());

		if (session)
		{
			session.time = Date.now();
			if (self._storage)
			{
				self._storage.update(session);
			}
			res.done(true);
		}
		else
		{
			res.done(false);
		}
	},

	// touch link item, keep link alive
	update: function(req, res)
	{
		var self = this;
		var id = req.get('id');
		var key = req.get('key');
		var value = req.get('value');
		var argc = req.get('argc');
		var session = self._sessions.get(id);

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

			if (self._storage)
			{
				self._storage.update(session);
			}
			res.done(true);
		}
		else if (req.get('create') === true)
		{
			var data;
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
				id = ++self._id;
			}
			var session = {
				'sid': id,
				'token': util.token(self._token_size) + id,
				'time': Date.now(),
				'data': data
			};

			// write to ram data
			self._sessions.set(id, session);

			// write to static storage
			if (self._storage){
				self._storage.update(session);
			}

			res.done(session);
		}
		else
		{
			res.done(false);
		}
	},

	// remove a link
	remove: function(req, res)
	{
		var self = this;
		var id = req.get();

		if (self._sessions.get(id))
		{
			self._sessions.delete(id);

			if (self._storage)
			{
				self._storage.remove(id);
			}

			res.done(true);
		}
		else
		{
			res.done(false);
		}
	},

	// get session by session_id
	getById: function(req, res)
	{
		var self = this;
		var id = req.get();
		var session = id ? self._sessions.get(id) : null;

		res.done(session || null);
	},

	// get session by token key
	getByToken: function(req, res)
	{
		var self = this;
		var token = req.get();
		var session = null;

		if (token)
		{
			for (var pair of self._sessions)
			{
				if (pair[1].token == token)
				{
					session = pair[1];
					break;
				}
			}
		}

		res.done(session);
	},
	findSession: function(req, res)
	{
		var self = this;
		var key = req.get('key');
		var value = req.get('val');
		var ret = [];
		for (var s of self._sessions.values())
		{
			if(util.getProp(s.data, key) === value) {
				ret.push(s);
			}
		}

		res.done(ret);
	},
	listSessions: function*(req, res)
	{
		var self = this;
		var ret = [];
		var param = req.get();
		var namespace = param.namespace;
		if(!namespace)
		{
			throw {message: '请指定namespace参数'};
		}

		var query = param.query;
		for(var pair of self._sessions)
		{
			var s_key = pair[0];
			var s = pair[1];
			if(s.data && s.data[namespace])
			{
				let sess = s.data[namespace];
				let valid = false;
				if(util.isEmpty(query))
				{
					valid = true;
				}
				else
				{
					for(let key in query)
					{
						if(query.hasOwnProperty(key) && sess[key] == query[key])
						{
							valid = true;
							break;
						}
					}
				}

				if(valid)
				{
					if(param.fields && param.fields.length)
					{
						let t = {};
						for(let field of param.fields)
						{
							if(sess.hasOwnProperty(field))
							{
								t[field] = sess[field];
							}
						}

						t._id = s_key;
						ret.push(t);
					}
					else
					{
						sess._id = s_key;
						ret.push(sess)
					}
				}
			}
		}

		var page = +param.page || 1;
		var size = +param.size || 10;
		var start = (page -1) * size;
		res.done({
			total: ret.length
			,page: page
			,size: size
			,items: ret.slice(start, start + size)
		});
	},
	_getSessions: function(req, res)
	{
		return this._sessions;
	}
});

function checkDataTimeout()
{
	var self = this;
	var timeout = Date.now() - self._timeout;
	for (var session of self._sessions)
	{
		if (session[1].time < timeout)
		{
			util.log(20, 'Session Timeout. (session_id: %d)', session[0]);
			self._sessions.delete(session[0]);
			if (self._storage)
			{
				self._storage.remove(session[0]);
			}
		}
	}
}


/**
 * Session Storage Module
 * ------------------------
 * Manager the static session data to the storage
 */
var serialize = require('../core/serialize');
function Storage(config, session)
{
	var self = this;
	// 引擎类型
	self._type = config.type || 'file';
	self._save_interval = (config.save_interval || 60) * 1000;
	self._session_modifyed = false;
	self._busy = false;
	self._load_id = 0;

	self._session = session;

	switch (self._type){
		case 'file':
			// 保存间隔
			var path = config.path || '/data/session.json';
			self._file_path = util.normalizePath(path);
			break;
		case 'mongo':
			self._connection = config.connection;
			self._collection = config.collection;
			self._mdb = null;
			self._coll = null;
			self._cache = new Map();
			break;
	}

	// 启动定时保存完整数据进程
	self._tid = setInterval(self.save.bind(self), self._save_interval);
}

function getMongoCollection(reconnect)
{
	var self = this;
	if (!reconnect && self._coll)
	{
		return self._coll;
	}

	if (self._mdb)
	{
		self._mdb.close(true);
		self._mdb = null;
	}

	var MongoClient = require('mongodb').MongoClient;
	return MongoClient.connect(self._connection).then(
		function(db)
		{
			self._mdb = db;
			return db.collection(self._collection);
		}
	).then(
		function(coll)
		{
			self._coll = coll;
			return coll;
		}
	);
}

// 加载所有数据
Storage.prototype.load = util.generator(function *(time)
{
	var self = this;
	var data;

	switch (self._type)
	{
		case 'file':
			try {
				data = yield util.toSync(
					require('fs').readFile,
					self._file_path
				);
				data = serialize.rawDecode(data);
			}
			catch (err){
				// set modify, init the session data
				self._session_modifyed = true;

				util.log(24, 'Loading Session Data Error:\n', err);
			}
			break;

		case 'mongo':
			var coll;
			try
			{
				coll = yield getMongoCollection.call(self);
				// remove all timeout session record
				yield coll.deleteMany({'time': {'$lt': time}});
				// find the
				data = yield self._coll.find().toArray();
			}
			catch (err)
			{
				coll = yield getMongoCollection.call(self, true);
				// remove all timeout session record
				yield coll.deleteMany({'time': {'$lt': time}});
				// find the
				data = yield self._coll.find().toArray();
			}
			break;
	}

	var sess;
	var max_id = 0;
	var result = new Map();
	while (data && data.length)
	{
		sess = data.pop();
		if (sess && sess.time >= time){
			max_id = Math.max(max_id, sess.sid);
			result.set(sess.sid, sess);
		}
	}
	self._load_id = max_id;
	return result;
});

function *saveToMongo(self, sessions, reconnect)
{
	var coll = yield getMongoCollection.call(self, reconnect);
	var gs = util.gSync();
	var cb = gs.cb();
	for (var pair of sessions)
	{
		// update or remove the session data
		if (pair[1] === null)
		{
			coll.deleteOne(
				{'_id': pair[0]},
				cb
			);
		}
		else
		{
			coll.findOneAndReplace(
				{'_id': pair[0]},
				pair[1],
				{'upsert': true},
				cb
			);
		}
		yield gs;
		gs.reset();

		sessions.delete(pair[0]);
	}
}

// 文件模式定时保存完整的会话信息
Storage.prototype.save = util.generator(function *()
{
	var self = this;

	if (!self._busy && self._session_modifyed)
	{
		self._busy = true;
		self._session_modifyed = false;

		switch (self._type)
		{
			case 'file':
				yield self._doSave(self._session._getSessions());
				break;

			case 'mongo':
				if (self._cache.size)
				{
					var cache = self._cache;
					self._cache = new Map();
					yield self._doSave(cache);
				}
				break;
		}
	}
});

Storage.prototype._doSave = function *(sessions)
{
	var self = this;
	self._busy = true;

	util.log(20, 'Saving session to storage..');

	// process session data, do save
	switch (self._type)
	{
		case 'file':
			var data = [];
			for (var sess of sessions)
			{
				data.push(sess[1]);
			}

			yield util.toSync(
				require('fs').writeFile,
				self._file_path,
				serialize.rawEncode(data)
			);
			break;

		case 'mongo':
			// empty session, skip process
			try
			{
				yield saveToMongo(self, sessions);
			}
			catch (err)
			{
				// try twice
				try
				{
					self._coll = null;
					yield saveToMongo(self, sessions, true);
				}
				catch (err2)
				{
					// restore the data into cache
					for (var pair of sessions)
					{
						if (!self._cache.has(pair[0]))
						{
							self._cache.set(pair[0], pair[1]);
						}
					}
					self._busy = false
					return false;
				}
			}
			break;
	}

	self._busy = false
	return true;
};

// 更新某一条会话记录
Storage.prototype.update = function(session)
{
	var self = this;
	self._session_modifyed = true;

	switch (self._type)
	{
		case 'file':
			return true;

		case 'mongo':
			self._cache.set(session.sid, session);
			return true;
	}
	return false;
};

Storage.prototype.remove = function(session_id)
{
	var self = this;
	self._session_modifyed = true;

	switch (self._type){
		case 'file':
			return true;

		case 'mongo':
			self._cache.set(session_id, null);
			return true;
	}
	return false;
};