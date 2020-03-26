/**
 * @file ModelDB 模块
 * ---------------------
 * 对象模型的方式操作数据库
 * 简单的配置初始化init，使用Schema对模型设计，model获取模型做数据库操作
 */

'use strict';
var Schema = require('./Schema');
var radon = require('radon');
var util = radon.util;
var DB = require('./db/MongoDB');
var Model = require('./Model');
var URI_REGX = /^(?:([^:]+):\/\/)?((?:[^\/]+\/)?(.+))$/; // http://aaa/bbb

/**
 * @namespace CacheSchema schema缓存
 * 
 * 加载schema文件
 */
var CacheSchema = {};
function getSchema(base, name){
	var schema;
	if (!(schema = CacheSchema[name])){
		try {
			schema = require(base + '/' + name + '.js');
		}catch (e){
			try {
				schema = require('../Model/' + name + '.js');
			}catch (err){
				util.log(
					30, 'Schema <%s> Not Found:\n%s\n%s',
					name, e.stack, err.stack
				);
				radon.throw(2004, [name]);
			}
		}
		CacheSchema[name] = schema;
	}
	return schema;
}

var ModelDB = {
	/** 
	 * 初始化配置
	 * @param config 配置
	 * @prop {Object} servers model使用的serve配制
	 * @prop {String} default_server 默认指定的server
	 * @prop {Object} models 模型配制
	 * @prop {String} schema schema存储的基础路径
	*/
	init: function(config) {
		var self = this;
		self.$config = config;
		self.$models = {};
		self.$dbs = {};
		self.init = function(){};
	},
	/* db 工具函数 */
	Helper: require('./dbHelper'),
	/* Schema 结构类 */
	Schema: Schema,
	/* Schema 实例 */
	newSchema: function(obj, base){
		return new Schema(obj, base);
	},
	/**
	 * 手动加载schema文件
	 * 
	 * @param {String} name -schema文件名
	 */
	getSchema: function(name){
		return getSchema(this.$config.schema, name);
	},
	/* 创建model对象 */
	model: function(name) {
		var self = this;
		var config = self.$config;
		var model_cfgs = config.models;
		var server_cfgs = config.servers;
		var match = URI_REGX.exec(name);
		name = match[2];

		var cfg = model_cfgs[name] || model_cfgs[match[3]] || null;
		cfg = cfg ? util.clone(cfg) : {};
		cfg.name = name;
		if (!cfg.server){
			cfg.server = config.default_server;
		}
		if (!cfg.collection){
			cfg.collection = match[3];
		}

		var path = config.schema;
		if(cfg.path) {
			path += cfg.path;
		}

		var server = match[1];
		if (!server){
			server = cfg.server;
			if (!server){
				radon.throw(2005, [name]);
			}
		}else {
			cfg.server = server;
		}
		if (!server_cfgs[server]){
			radon.throw(2006, [server]);
		}

		var uri = server + '://' + name;
		if (!self.$models[uri]){
			var driver = self.$dbs[server];
			server_cfgs = server_cfgs[server];
			if (!driver){
				if(!server_cfgs.pool){
					server_cfgs.pool = config.default_pool;
				}
				if (server_cfgs.type == 'MongoDB'){
					driver = self.$dbs[server] = new DB(server_cfgs);
				}else {
					radon.throw(2007, [server_cfgs.type]);
				}
			}
			// 创建model对象
			var schema = getSchema(path, name);
			self.$models[uri] = Model.compile(self, cfg, schema, driver);
		}
		return self.$models[uri];
	},
	/* 生成自增ID */
	genId: function(idName) {
		if(idName){
			var IdCounter = this.model('lib/IdCounter');
			return IdCounter.findAndModify(
					{"_id": idName},
					{"$inc": {"id": 1}},
					{"new": true}
				).then(function(counter){
					if(!counter){
						counter = new IdCounter(
							{"_id": idName, "id": 1}
						);
						return counter.save().then(function(counter){
							return counter.id;
						});
					}else{
						return counter.id;
					}
				}).catch(function(err){
					throw err;
				});
		}else{
			return util.promiseData(0);
		}
	}
};
module.exports = ModelDB;
