/**
 * Radon backend framwork
 */

/**
 * 基础对象模块
 */
var base = require('./core/base');
exports.Class = base.Class;

var Int64 = require('./core/Int64');
exports.Int64 = Int64;

var json64 = require('./core/json64');
exports.json64 = json64;

/**
 * 工具函数库模块
 */
var util = require('./core/util');
var node_util = require('./core/node_util');
/*
	todo 扩展util. 以后可能直接写在util.js里.
 */
for(var prop in node_util) {
	if(node_util.hasOwnProperty(prop) && !util.hasOwnProperty(prop)) {
		util[prop] = node_util[prop];
	}
}

exports.util = util;
exports.sync = require('./core/sync');

/**
 * 初始化命令行参数对象
 */
var argv = util.parseCommandLine();
exports.getCmdParam = function(property){
	if (arguments.length == 0){
		return argv;
	}else {
		return (argv[property] || null);
	}
}

/**
 * 初始化引用基础路径参数
 */
exports.require = util.require;

/**
 * 系统默认配置文件读取方法
 */
var CONFIG_FILE = false;
exports.config = function(property){
	return (CONFIG_FILE ? util.config(CONFIG_FILE, property) : null);
}

/**
 * 模块加载方法
 */
var USE_PATHS = {};
exports.use = function(path) {
	if (!path || typeof path != 'string'){
		return false;
	}
	// 转换路径绑定
	var pos = 0;
	if (path[0] == '@'){
		pos = path.indexOf('/');
		if (pos > 0){
			var tag = path.substr(0,pos);
			if (USE_PATHS[tag]){
				path = USE_PATHS[tag] + path.slice(pos);
			}
		}
	}
	if (pos <= 0 && USE_PATHS[path]){
		path = USE_PATHS[path];
	}

	// 检查是否需要读取模块的属性
	path = path.split('.');
	var mod = path.length - 1;
	if (mod > 0 && path[mod].indexOf('/') === -1){
		mod = path.pop();
	}else {
		mod = 0;
	}
	path = path.join('.');

	var module = exports.require(path);
	if (mod == 'js' || mod == 'json'){
		return module[mod] || module;
	}else {
		return mod ? module[mod] : module;
	}
};

/**
 * 集中错误处理模块
 */
var error = require('./core/error.js');
exports.error_message = error.message;
exports.error = error.getError;
exports.throw = error.throw;
exports.getError = error.getError;
exports.stack = error.stack;

/**
 * ModelDB 数据库模块
 */
exports.ModelDB = function(){
	return require('./ModelDB');
}

/* radon 变量存储 */
var _globalData = new Map();
exports.setGlobalData = function(key, value) {
	_globalData.set(key, value);
}
exports.getGlobalData = function(key, value) {
	return _globalData.get(key);
}


/**
 * 设置/获取上下文参数
 */
exports.resetContext = function()
{
	util.setContext(new Map());
}
exports.setContextData = function(name, value){
	var runtime = util.getContext();
	if (!runtime)
	{
		runtime = new Map();
		util.setContext(runtime);
	}

	runtime.set(name, value);
	return exports;
}
exports.getContextData = function(name){
	var runtime = util.getContext();
	if(runtime){
		if (name){
			return runtime.has(name) ? runtime.get(name) : null;
		}else {
			return runtime;
		}
	}
	return null;
}

/**
 * 设置/获取纤程登陆用户信息
 */
var userdata_var_name = '__userdata__';
var userdata_init_cb = null;
exports.setUserGetter = function(callback){
	userdata_init_cb = callback;
}
exports.getUser = util.generator(function *(ns){
	var key = userdata_var_name + ns;
	var user = exports.getContextData(key);
	if (!user && userdata_init_cb){
		// 调用用户数据初始化回调函数
		// 返回的用户数据应该调用 formatUserRight()
		// 方法附加格式化后的用户权限数据
		user = yield userdata_init_cb(ns);
		exports.setContextData(key, user);
	}
	return user;
});
exports.setUser = function(ns, user){
	exports.setContextData(userdata_var_name + ns, user);
}

// check user session access right
// user session data must be a user modul object
exports.checkAccess = function *(ns, right, code){
	var user = yield exports.getUser(ns);
	if (right && user && user.logined && user.logined())
	{
		if (right == '*' || user.isMaster()){
			return 0;
		}
		var user_right = user.getRights();
		if (user_right)
		{
			var pass = (right[0] == '&');
			if (pass){
				right = right.slice(1);
			}
			var rights = right.split(',');
			for (var i=rights.length; i>0;){
				if (pass)
				{
					if (user_right.indexOf(rights[--i]) == -1)
					{
						pass = 0;
						break;
					}
				}
				else if (~user_right.indexOf(rights[--i]))
				{
					return 0;
				}
			}
			if (pass)
			{
				return 0;
			}
		}
		// 没有找到权限点, 没有权限
		return (code || 4001);
	}

	// 用户没有登陆, 没有用户数据或者没有权限记录
	return 4000;
};

/**
 * 初始化Radon配置
 * @param  {Object} cfg 配置参数对象
 */
exports.init = function(cfg){
	// config file path
	var conf_file = (cfg && cfg.config_file) || argv.config_file;
	if (conf_file){
		CONFIG_FILE = conf_file;
	}

	// init the base path setting
	var conf_root = (cfg && cfg.app_root) || argv.app_root;
	if (conf_root){
		util.initPath(conf_root);
	}

	// setup debug level
	var conf_debug = argv.debug;
	if (cfg && cfg.hasOwnProperty('debug'))
	{
		conf_debug = cfg.debug;
	}
	else if (conf_debug)
	{
		switch (conf_debug)
		{
			case 'false':
				conf_debug = false;
				break;
			case 'true':
				conf_debug = true;
				break;
			default:
				conf_debug = +conf_debug || false;
				break;
		}
	}
	else
	{
		conf_debug = exports.config('radon.debug_mode') || false;
	}
	var skips = exports.config('radon.debug_skips') || false;
	util.set_debug(conf_debug, skips);

	// setup use path config
	if (cfg && cfg.paths){
		USE_PATHS = cfg.paths;
	}else {
		USE_PATHS = exports.config('radon.paths') || {};
	}

	// setup user error_file path
	error.setAppErrorFile(
		util.normalizePath(exports.config('radon.error_file'))
	);
}

// auto init
exports.init({debug: true});

var file_service = require('./modules/file_service');
exports.fileService = file_service;