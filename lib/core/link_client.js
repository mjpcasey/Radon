/**
 * @file Radon连接数据模块
 */
"use strict";

var base = require('./base');
var util = require('./util');

module.exports = base.Class.extend({
	CONSTRUCTOR: function(ipc, config, event_name)
	{
		var self = this;
		self._ipc = ipc;

		// 配置信息
		self._timeout	= (config.timeout || 600) * 1000;
		self._touchtime	= (config.touchtime || 180) * 1000;
		self._interval	= (config.interval || 10) * 1000;
		self._prefix	= (config.prefix || '');

		self._link_data = {
			'name': self._prefix,
			'ttl': self._timeout,
			'event': (event_name || 'RADON.NOTIFY_LINK'),
			'event_remove': 'RADON.REMOVE_LINK'
		};

		// 连接列表记录
		self._links = new Map();

		// 连接分组信息
		self._groups = new Map();

		// 检查链接超时时间和更新记录
		self._tid = setInterval(
			self.checkUpdateTimeout.bind(self),
			self._interval
		);
	},
	/* 删除连接 */
	free: function()
	{
		clearInterval(this._tid);
		self._links.clean();
		self._groups.clean();
	},
	// link manager notify message process
	onNotify: function(req, res)
	{
		var link_id = req.get('id');
		var link = this._links.get(link_id);
		if (link)
		{
			link.actions = link.actions.concat(req.get('actions'));
			res.done(true);
		}
		else
		{
			// link not found in this module
			return false;
		}
		// notify set session_id
		// notify set client message. eg. cookie, header, actions else..
	},
	getNotifyEvent: function()
	{
		var self = this;
		return [self._link_data.event, self.onNotify.bind(self)];
	},
	getRemoveEvent: function()
	{
		var self = this;
		return [self._link_data.event_remove, self.onNotify.bind(self)];
	},
	/**
	 * 获取指定的连接对象的用户自定义数据
	 * 
	 * @param {String} link_id 连接ID
	 */
	get: function(link_id)
	{
		var link = this._links.get(link_id);
		return link ? link.data : null;
	},
	getActions: function(link_id)
	{
		var link = this._links.get(link_id);
		return link ? link.actions.splice(0, link.actions.length) : [];
	},
	/**
	 * 获取会话ID
	 * 
	 * @param {Number} link_id -连接ID
	 * @param {String} token -session token
	 */
	getSessionId: function(link_id, token)
	{
		var self = this;
		var link = self._links.get(link_id);
		if (link && token)
		{
			if (~link.session_id && token == link.session_token)
			{
				// has none init session_id and same token
				return util.promiseResolve(link.session_id);
			}
			else
			{
				return self._ipc.getSessionByToken(token).then(
					function(session)
					{
						if (session)
						{
							link.session_id = session.sid;
						}
						else
						{
							link.session_id = 0;
						}
						link.session_token = token;
						return link.session_id;
					}
				);
			}
		}
		return util.promiseResolve(0);
	},
	// 设置连接会话ID
	setSession: function(link_id, session_id, session_token)
	{
		var self = this;
		var link = self._links.get(link_id);
		if (link)
		{
			link.session_id = session_id;
			link.session_token = session_token || false;
			return true;
		}
		else
		{
			return false;
		}
	},
	// 创建一个连接记录
	create: function(data)
	{
		var self = this;
		// 向连接管理模块注册连接
		return self._ipc.registerLink(self._link_data)
		.then(
			function(link)
			{
				if (link)
				{
					var link_id = link.id;
					var now = Date.now();
					self._links.set(
						link_id,
						{
							'id': link_id,
							'time': now,
							'touch': now,
							'active': false,
							'session_id': -1,
							'session_token': false,
							'groups': [],
							'actions': [],
							'data': data
						}
					);
					return link_id;
				}

				// register link false
				return 0;
			}
		);
	},
	/**
	 * update link item time
	 * 
	 * @param {String} link_id 连接ID
	 */
	touch: function(link_id)
	{
		var self = this;
		var link = self._links.get(link_id);
		if (link)
		{
			var now = Date.now();
			// update link active time
			link.time = now;

			// check if need to update link manager
			if (link.touch < now - self._touchtime)
			{
				util.log(21, '<%s> 更新系统连接活动状态', link_id);
				// touch update link manager, create if not exists
				link.touch = now;
				self._ipc.touchLink(
					link_id,
					link.session_id,
					self._link_data
				);
			}
			return true;
		}else {
			return false;
		}
	},
	// 设置连接是否激活中
	active: function(link_id, active)
	{
		var self = this;
		if (link_id && self._links.has(link_id)){
			var link = self._links.get(link_id);
			link.active = active;
			if (!active){
				link.time = Date.now();
			}
			return true;
		}else {
			return false;
		}
	},
	// 删除指定连接记录
	remove: function(link_id)
	{
		var self = this;
		if (self._links.has(link_id))
		{
			self._links.delete(link_id);
			self._ipc.removeLink(link_id);
			return true;
		}
		else
		{
			return false;
		}
	},
	// 设置连接分组
	setGroups: function(link_id, groups)
	{
		var self = this;
		var link = self._links.get(link_id);
		if (link)
		{
			var group;
			// 移出旧分组
			for (group of self._groups)
			{
				group[1].delete(link_id);
			}

			// 加入新分组
			link.groups = groups;
			for (var i=groups.length; i-->0;)
			{
				group = groups[i];
				if (self._groups.has(group))
				{
					self._groups.get(group).add(link_id);
				}
				else
				{
					self._groups.set(group, new Set([link_id]));
				}
			}
			return true;
		}else {
			return false;
		}
	},
	// get link groups
	getGroups: function(link_id)
	{
		var link = this._links.get(link_id);
		if (link)
		{
			return link.groups;
		}
		else
		{
			return [];
		}
	},
	// 获取指定分组的连接记录
	getLinksByGroup: function(group)
	{
		var self = this;
		var result = [];
		var links = self._groups.get(group);
		if (links)
		{
			for (var link_id of links)
			{
				if (self._links.has(link_id))
				{
					result.push(self._links.get(link_id).data);
				}
				else
				{
					delete links.delete(link_id);
				}
			}
		}
		return result;
	},

	// 检查链接记录超时状态和自动更新记录活跃时间
	checkUpdateTimeout: function()
	{
		var self = this;
		var ipc = self._ipc;
		var now = Date.now();
		var timeout = now - self._timeout;
		var touch_timeout = now - self._touchtime;
		var link_id, link;

		// 连接超时时间
		for (link of self._links)
		{
			link_id = link[0];
			link = link[1];

			if (link.active)
			{
				util.log(20, '<%s> 连接活跃中, 检查更新间隔时间', link_id);
				// 连接有活跃, 更新连接时间
				if (link.touch < touch_timeout)
				{
					util.log(21, '<%s> 更新系统连接活动状态', link_id);
					link.touch = now;
					ipc.touchLink(
						link_id,
						link.session_id,
						self._link_data
					);
				}
			}
			else if (link.time < timeout)
			{
				// 连接活跃超时
				self._links.delete(link_id);
				ipc.removeLink(link_id);
				util.log(22, '<%s> 连接断线超时, 移除连接记录', link_id);
			}
		}

		// 检查分组连接状态
		for (link of self._groups)
		{
			for (link_id of link[1])
			{
				if (!self._links.has(link_id))
				{
					link[1].delete(link_id);
				}
			}
			if (link[1].size == 0)
			{
				self._groups.delete(link[0]);
			}
		}
	}
});