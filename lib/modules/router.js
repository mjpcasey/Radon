/**
 * @file Radon Router Module
 * ----------------------------------------
 * process router config and pass request
 */

"use strict";

var radon = require('../radon');
var util = radon.util;

var mod = radon.Class.extend({
	init: function(config, ipc, last)
	{
		var self = this;

		// 路由规则
		self._rules = [];
		self._groups = new Map();
		self._modules = (last && last._modules) || {};
		self._ipc = ipc;

		// 根据配置中指定的路由文件读取配置信息
		var router_file = config.router_file;
		if (router_file){
			var conf = util.config(router_file);
			if (conf.rules){
				self._rules = conf.rules;
			}
			if (conf.groups)
			{
				for (var name in conf.groups)
				{
					self._groups.set(name, conf.groups[name]);
				}
			}
			// default cast process group
			self._default_group_process = conf.default_group || false;
		}
	},
	getEvents: function()
	{
		return [
			['getRoute', this.getRoute],
			['regModule', this.registerModule]
		];
	},
	/**
	 * 通过uri进行查找
	 */
	_getRouteByUri: function(uri)
	{
		var rules = this._rules;
		var rule, route, matchs;
		for (var i=0; i<rules.length; i++)
		{
			rule = rules[i];
			if (rule.match)
			{
				// 正则匹配方式
				if (matchs = rule.match.exec(uri))
				{
					if (route = this._processRule(rule, uri, matchs))
					{
						return route;
					}
				}
			}
			else if (rule.uri && uri.indexOf(rule.uri) === 0)
			{
				// 字符串uri方式判断
				if (route = this._processRule(rule, uri))
				{
					return route;
				}
			}
		}

		return false;
	},
	/**
	 * 通过模块名称进行查找
	 */
	_getRouteByModule: function(module_name)
	{
		// todo: support load balance
		for (var proc in this._modules)
		{
			if (this._modules[proc].indexOf(module_name) != -1)
			{
				return proc;
			}
		}
		return false;
	},
	/**
	 * 根据router配置的group进行查找
	 * 
	 * @param {string} group_name -grouo名
	 */
	_getRouteByGroup: function(group_name)
	{
		var process =  this._groups.get(group_name) || this._default_group_process;
		if (process)
		{
			return {'process': process};
		}
		else
		{
			return false;
		}
	},
	// 处理转发规则
	_processRule: function(rule, uri, matchs)
	{
		var route;
		if (rule.handler)
		{
			route = rule.handler(uri, matchs);
			if (typeof route == 'string')
			{
				var uriRegx = /^([^@:]+)?(?:@([^:]+))?(?:\:(.+))?$/;
				var match = uriRegx.exec(route);
				route = {
					'process': match[2],
					'module': match[1],
					'event': match[3]
				};
			}
		}
		else
		{
			route = {
				'process': replaceMark(rule.process, matchs),
				'module': replaceMark(rule.module, matchs),
				'event': replaceMark(rule.event, matchs),
			};

		}
		// find the module process name
		if (route && !route.process)
		{
			route.process = this._getRouteByModule(route.module);
			if (!route.process)
			{
				return false;
			}
		}
		return route;
	},

	/**
	 * 注册进程模块数据-方便后期遍历查找
	 */
	registerModule: function(req, res)
	{
		var process_name = req.get('name');
		var modules = req.get('modules');

		this._modules[process_name] = modules;

		res.done(true);
	},
	// 获取指定条件的符合路由信息
	getRoute: function(req, res)
	{
		var route, param;
		var match = '';
		if (param = req.get('group'))
		{
			route = this._getRouteByGroup(param);
			match = 'group: ' + param;
		}
		if (!route && (param = req.get('module')))
		{
			route = this._getRouteByModule(param);
			if (route)
			{
				route = {
					'process': route
				};
				match = 'module: ' + param;
			}
		}
		if (!route && (param = req.get('uri')))
		{
			route = this._getRouteByUri(param);
			match = param;
		}

		// check if we can find an route for data
		if (route){
			res.done(route);
		}else {
			// no route, throw an exception
			radon.throw(3100, [param]);
		}
	}
});


// 处理匹配标记
var _mark_regx = /\{\$(\d+)\}/g;
var _mark_maps = null;
function replaceMark(str, marks){
	if (marks && str)
	{
		_mark_maps = marks;
		return str.replace(_mark_regx, replaceMarkCallback);
	}
	else
	{
		return str;
	}
}
function replaceMarkCallback(match, mark){
	if (mark > 0 && _mark_maps[mark] !== undefined){
		return _mark_maps[mark];
	}else {
		return match;
	}
}

module.exports = mod;