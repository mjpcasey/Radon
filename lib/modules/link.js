/**
 * Radon Link Module
 * ----------------------------------------
 * process router config and pass request
 */

"use strict";

var base = require('../core/base');
var util = require('../core/util');

module.exports = base.Class.extend({
	init: function(config, ipc, last)
	{
		var self = this;
		self._ipc = ipc;
		self._id = (last && last._id) || 0;
		self._ttl = config.ttl || 60000;

		// link pool
		if (last)
		{
			self._links = last._links;
			clearInterval(last._tid);
		}
		else
		{
			self._links = new Map();
		}

		self._tid = setInterval(checkDataTimeout.bind(self), self._ttl);
	},
	getEvents: function()
	{
		return [
			['register', this.register],
			['touch', this.touch],
			['remove', this.remove],
			['notify', this.notify],
			['get', this.get]
		];
	},

	// notify link process
	notify: function(req, res)
	{
		var link_id = req.get('id');
		var link = this._links.get(link_id);
		if (link)
		{
			// send request to link process
			var target = {
				'process': link.process,
				'module': link.module,
				'event': link.data && link.data.event || 'RADON.NOTIFY_LINK'
			};
			return res.request(target, req.get());
		}
		else
		{
			// no link data, return fail
			res.done(false);
		}
	},

	// 注册连接
	register: function(req, res)
	{
		var self = this;
		var ttl = req.get('ttl', self._ttl);
		var link_id = ++self._id + '.' + util.token(5);

		var link = {
			'id': link_id,
			'time': Date.now(),
			'ttl': ttl,
			'process': req.get('process'),
			'module': req.get('module'),
			'data': req.get('data') || null
		};
		self._links.set(link_id, link);

		res.done(link);
	},

	// 更新链接，保持其活跃
	touch: function(req, res)
	{
		var self = this;
		var link_id = req.get('id');
		var link = self._links.get(link_id);
		if (link)
		{
			// update link expire time
			link.time = Date.now() + link.ttl;
			link.process = req.get('process');
			link.module = req.get('module');

			// if set data, merge the data config
			var data = req.get('data');
			if (data)
			{
				var link_data = link.data;
				if (link_data)
				{
					for (var i in data)
					{
						link_data[i] = data[i];
					}
				}
				else
				{
					link.data = data;
				}
			}

			var session_id = req.get('session_id');
			if (session_id)
			{
				self._ipc.touchSession(session_id);
			}

			// return update success
			res.done(true);
		}
		else
		{
			// link not found, update fail
			res.done(false);
		}
	},

	// remove a link
	remove: function(req, res)
	{
		var self = this;
		var link_id = req.get();
		if (self._links.get(link_id))
		{
			self._links.delete(link_id);
			res.done(true);
		}
		else
		{
			res.done(false);
		}
	},

	// get link by link id
	get: function(req, res)
	{
		var self = this;
		var link_id = req.get('id');
		var link = null;

		if (link_id)
		{
			link = self._links.get(link_id);
		}

		if (link && req.get('exact'))
		{
			if (link.process != req.get('process') ||
				link.module != req.get('module'))
			{
				link = null;
			}
		}
		res.done(link);
	}
});

function checkDataTimeout()
{
	var now = Date.now();
	for (var link of this._links)
	{
		if (link[1].time < now - link[1].ttl)
		{
			util.log(20, 'Link Timeout. (link_id: %s)', link[0]);
			this._links.delete(link[0]);
			var target = {
				'process': link[1].process,
				'module': link[1].module,
				'event': 'RADON.REMOVE_LINK'
			};

			return this._ipc.request(target, {link_id: link[0]});
		}
	}
}