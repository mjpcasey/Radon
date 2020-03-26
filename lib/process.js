/**
 * Radon Master Process Module
 * ----------------------
 * Read config file, load and init modules
 */
"use strict";
var admin = require('./modules/admin.js');
var radon = require('./radon');
var child = require('./core/child');
var CONST = require('./core/const');
var transport = require('./core/transport');
var util = radon.util;
var normalizePath = util.normalizePath;
var log = util.log;

// 初始化 abort 的数组
if(!global._Abort)
{
	global._Abort = new Map();
}

const STATUS_RUNNING = 1;
const STATUS_CLEARING = CONST.STATUS_CLEAR;
const STATUS_CLEARED = 3;
const STATUS_CLEAR_FORCE = 4;
const STATUS_STOPPING = CONST.STATUS_STOPPING;
const STATUS_STOPED = CONST.STATUS_STOP;

// caught unknow exceprion, and send log to master process
process.on('uncaughtException', function(err) {
	try {
		var data = [
			(new Date()).toLocaleString(),
			(err.message || err.toString())
		];
		if (err.stack){
			data.push(err.stack);
		}
		PROC.send(CONST.MSG_EXCEPTION, data);
		log(4, "Process Uncaught Exception: (%s)\n%s", PROC_ID, err.stack);
	}catch(e){
		console.error('Uncaught Exception:\n', err, e);
	}
});

// init ipc process object
var STATUS = false;
var INIT_DATA = null;
var PROC_ID = radon.getCmdParam('id');
var PROC_NAME = '';
var PROC_DAEMON = '';
var PROC = new child.node(PROC_ID);
var EVENTS = new transport.Trigger();

/**
 * 当前进程的所有模块存储
 * @namespace MODULES
 */
var MODULES = new Map();

var MANAGER;
var FORCE_CLEAR;

/* 事务管理 */
var REQ_TASK = {};
var JOBS = 0;
var JOBS_COUNT = 0;
var JOBS_TIME = 0;
var TRANSACTION = {
	enter: function(force)
	{
		if (!force && STATUS == STATUS_STOPPING)
		{
			radon.throw(3007);
		}

		JOBS++;
	},
	leave: function()
	{
		if (JOBS <= 0)
		{
			var e = new Error();
			log(4, 'Transaction leave overflow.\n%s', e.stack);
			return;
		}

		if (--JOBS && !FORCE_CLEAR)
		{
			return;
		}

		switch (STATUS)
		{

			case STATUS_CLEAR_FORCE:
				STATUS = STATUS_CLEARED;
				log(1, 'Process %s Cleared Force.', PROC_ID);
				PROC.send(CONST.MSG_CLEAR, process.pid);
				admin.notify(CONST.MSG_CLEAR, process.pid);
				break;
			case STATUS_CLEARING:
				STATUS = STATUS_CLEARED;
				log(1, 'Process %s Cleared.', PROC_ID);
				PROC.send(CONST.MSG_CLEAR, process.pid);
				admin.notify(CONST.MSG_CLEAR, process.pid);
				break;

			case STATUS_STOPPING:
				STATUS = STATUS_STOPED;
				// notify all module to halt
				for (var pair of MODULES)
				{
					if (pair[1].module.unload)
					{
						try
						{
							pair[1].module.unload(STATUS_STOPED, TRANSACTION);
						}
						catch(e)
						{
							log(4, 'Unload Module Exception', (e.stack || e));
						}
					}
				}
				process.exit(0);
				break;
		}
	},
	enterTrace(event) {
		let c = JOBS_COUNT++;
		REQ_TASK[c] = {t: Date.now(), e: event};
		return c;
	},
	leaveTrace(c) {
		delete REQ_TASK[c];
	}
};

/**
 * 守护进程初始化子进程
 * 
 * @prop daemon 组名称
 * @prop process 进程名称
 * @prop config_file 配置文件
 * @prop single_mode 是否为单进程模式
 * @prop debug 是否为debug模式
 * @prop monitor_port 监听的端口
 * @prop app_root app根路径
 */
PROC.on(CONST.MSG_INIT, function(data){
	// init process once
	if (STATUS){
		return;
	}

	STATUS = STATUS_RUNNING;
	INIT_DATA = data;

	// init radon environment
	radon.init(data);
	PROC_NAME = data.process;
	PROC_DAEMON = data.daemon;
	log(0, 'Process Inited (%s)', PROC_ID);

	// use remote log out
	util.setLogCallback(remoteLog);

	// loading process config
	var config;
	if (data.single_mode) {
		var processes = radon.config('radon.processes');
		var modules = [];
		for (var proc in processes) {
			modules.push.apply(modules, processes[proc].modules);
		}
		config = {
			force_clear: true,
			modules: modules
		};
	}
	else {
		config = radon.config('radon.processes.' + PROC_NAME);
	}

	FORCE_CLEAR = config.hasOwnProperty('force_clear') ? config.force_clear : data.force_clear;
	// create the transport module
	MANAGER = new transport.Manager(
		PROC_NAME,
		config,
		radon.config('radon.transport')
	);
	MANAGER.setCallbacks({
		'send': PROC.send.bind(PROC, CONST.MSG_IPC),
		'onSend': onMessageSend,
		'onRequest': onMessageRequest
	});
	// bind process message callback
	PROC.on(CONST.MSG_IPC, MANAGER.onMessage.bind(MANAGER));

	// set global object data
	radon.setGlobalData('RADON_IPC', MANAGER);
	radon.setGlobalData('RADON_TRANSACTION', TRANSACTION);

	// process inited, start loading the process modules
	for (var i=config.modules.length; i-->0;){
		loadModule(config.modules[i]);
	}

	// register modules to router
	var keys = [];
	for (var ks of MODULES)
	{
		keys.push(ks[0]);
	}
	MANAGER.registerModuels(PROC_NAME, keys);

	if(process.platform == 'linux') {
		try
		{
			var monitor = require('monitor').client;
			monitor.init(data.monitor_port);
		}
		catch(e){log(4, 'No Monitor Module');}
	}
	PROC.send(CONST.MSG_INITED, [process.pid, data]);

	// set timer to clear the timeout aborted queue
	setInterval(checkAbortTimeout, 300 * 1000);
});

/* 守护进程消息管理 */
PROC.on(CONST.MSG_SYS, function(data){
	var type = data[0];
	var param = data[1];

	switch (type)
	{
		// refresh config cache
		case 'reload':
			util.reload_config();
			log(1, 'Process %s config cache updated.', PROC_ID);
			break;

		// request to clear jobs, after done, send the MSG_CLEAR back
		case 'clear':
			if(FORCE_CLEAR)
			{
				REQUEST_SET.forEach(function(req) {
					req && req.response && req.response.error({code: 3007, message: 'Force End The Process'});
				});

				REQUEST_SET.clear();
			}

			updateStatus(FORCE_CLEAR ? STATUS_CLEAR_FORCE : STATUS_CLEARING);
			break;

		// clear jobs and exit process
		case 'stop':
			updateStatus(STATUS_STOPPING);
			break;
	}
});

/**
 * 注册单个模块 - 实例ipc、监听模块接口列表事件、beforeAction、afterAction
 * 
 * @param {Object} module_config -模块配置
 * @prop {string} module_config.name -模块名称
 * @prop {string} module_config.file -模块文件路径
 */
function loadModule(module_config)
{
	var name = module_config.name;

	// unload existed module
	var last = MODULES.get(name);
	if (last){
		if (last.module.unload){
			try {
				last.module.unload('reload', TRANSACTION);
			}
			catch (err)
			{
				// new module error, or module skip reload
				return;
			}
		}
		EVENTS.off(null, name);
		last = last.module;
	}

	// load new module script file and create module instance
	var file = util.normalizePath(module_config.file);
	var CLASS = require(file);
	var mod = new CLASS();
	var ipc = new transport.Ipc(name, MANAGER);
	
	// 模块初始化
	mod.init(module_config, ipc, last, TRANSACTION);

	MODULES.set(
		name,
		{
			'module': mod,
			'name': name,
			'config': module_config,
			'time': Date.now()
		}
	);

	function *callback_warp(req)
	{
		var res = new transport.Response(name, req);
		// req 里保存response
		req.response = res;
		var result = yield this[1].call(mod, req, res);

		if (res.isDone())
		{
			result = res.getDoneResult();
		}

		// has data, auto reply and done
		if (result !== undefined && req.isRequest())
		{
			res.reply(result);
		}
		return res.isDone();
	}

	// register module beforeAction
	var cb;
	if (mod.beforeAction)
	{
		cb = callback_warp.bind(['.beforeAction', mod.beforeAction]);
		EVENTS.on('#.*.beforeAction', cb, name);
		EVENTS.on('#.'+name+'.beforeAction', cb, name);
	}

	// register module event
	if (mod.getEvents)
	{
		var evts = mod.getEvents();
		for (var i=evts.length; i-->0;){
			cb = callback_warp.bind(evts[i]);
			EVENTS.on('*.'+evts[i][0], cb, name);
			EVENTS.on(name+'.'+evts[i][0], cb, name);
		}
	}
	// register module afterAction
	if (mod.afterAction)
	{
		cb = callback_warp.bind(['.afterAction', mod.afterAction]);
		EVENTS.on('#.*.afterAction', cb, name);
		EVENTS.on('#.'+name+'.afterAction', cb, name);
	}
}
/**
 * IPC [send]类型消息的处理函数
 */
var onMessageSend = util.generator(function *(req){
	JOBS_COUNT++;
	TRANSACTION.enter();
	var t = Date.now();
	try
	{
		// call module event
		yield triggerEvent(req);
	}
	catch (err)
	{
		log(
			54,
			'Process::onMessageSend() uncaught exception\n',
			err && err.stack || err
		);
	}
	TRANSACTION.leave();
	JOBS_TIME += Date.now() - t;
});
/**
 *  IPC [req]类型消息的处理函数
 */
var REQUEST_SET = new Map();
var onMessageRequest = util.generator(function *(req){
	var c = JOBS_COUNT++;
	TRANSACTION.enter();
	var error;
	var is_request = req._is_request;
	FORCE_CLEAR && is_request && REQUEST_SET.set(req._count_id, req);

	let header = req.getHeader();
	var mark = header && header.session_id || 0;
	let before_mem;
	if(mark)
	{
		before_mem = process.memoryUsage();
	}

	var t = Date.now();

	let target_text = `${header.module}/${header.event}`;
	let source_text = `${header.source_process}/${header.source_module}/${header.origin_event || ''}`;
	REQ_TASK[c] = {t: Date.now(), e: target_text};
	target_text = header.process + '/' + target_text;
	try
	{
		// call module event
		var count = yield triggerEvent(req);
	}
	catch (err)
	{
		log(
			54,
			'Process::onMessageRequest() exception\n',
			err && err.stack || err
		);
		error = err;
	}

	delete REQ_TASK[c];
	FORCE_CLEAR && is_request && REQUEST_SET.delete(req._count_id);
	TRANSACTION.leave();
	JOBS_TIME += Date.now() - t;

	if(mark)
	{
		let after_mem = process.memoryUsage();
		util.log(101, `Process Id: ${process.pid};【${source_text} --> ${target_text}】Memory: Now Rss: ${formatSize(after_mem.rss)}, The Rss Raise: ${formatSize(after_mem.rss - before_mem.rss)}`);
		after_mem = null;
		before_mem = null;
	}

	source_text = null;
	target_text = null;

	// throw out the event exception
	if (error)
	{
		throw error;
	}

	// check if has any match event called
	if (count === 0)
	{
		radon.throw(3000, [PROC_NAME, req.getModule(), req.getEvent()]);
	}
});
/**
 * 触发模块监听的事件
 * 		包含默认的beforeAction、afterAction
 * 		以及header中的目标模块的目标方法
 */
function *triggerEvent(req)
{
	var dst_module = req.getModule();
	var dst_event = req.getEvent();
	var count = 0;
	var ret;

	// reset new context
	radon.resetContext();

	// call beforeAction
	ret = yield EVENTS.emit('#.'+dst_module+'.beforeAction', req);
	if (ret < 0)
	{
		return (count - ret);
	}
	count += ret;

	// call named event
	ret = yield EVENTS.emit(dst_module+'.'+dst_event, req);
	if (ret < 0)
	{
		return (count - ret);
	}
	count += ret;

	// call anonymouse event
	if (dst_event != '*')
	{
		ret = yield EVENTS.emit(dst_module+'.*', req);
		if (ret < 0)
		{
			return (count - ret);
		}
		count += ret;
	}

	// call afterAction
	ret = yield EVENTS.emit('#.'+dst_module+'.afterAction', req);
	if (ret < 0)
	{
		return (count - ret);
	}
	count += ret;

	// return call count
	return count;
}
/**
 * 发送日志信息,由deamon进程统一输出到控制台 deamon.js L:649
 * 
 * @param {Number} level -日志等级
 * @param {Array} args -args[1] 日志信息
 */
function remoteLog(level, args)
{
	PROC.send(CONST.MSG_LOG, [level, args]);
}
/**
 * 更新当前进程的运行状态
 * 
 * @param {Number|String} new_status 新的状态
 */
function updateStatus(new_status)
{
	TRANSACTION.enter(true);

	if (STATUS == STATUS_RUNNING && new_status != STATUS_RUNNING)
	{
		// notify all module to halt
		for (var pair of MODULES)
		{
			if (pair[1].module.unload)
			{
				pair[1].module.unload(new_status, TRANSACTION);
			}
		}
	}

	STATUS = new_status;

	// check current jobs
	TRANSACTION.leave();
}

// admin manager function
function adminCommand(cmd, data)
{
	switch (cmd)
	{
		// request to clear the process
		case 'clear':
			updateStatus(FORCE_CLEAR ? STATUS_CLEAR_FORCE : STATUS_CLEARING);
			//updateStatus(STATUS_CLEARING);
			// return the running jobs count
			return JOBS;

		// request to do real stop
		case 'stop':
			updateStatus(STATUS_STOPPING);
			break;

		// process status data
		case 'status':
			return {
				'status': STATUS,
				'jobs_count': JOBS_COUNT,
				'jobs': JOBS,
				'jobs_time': JOBS_TIME,
				'req_task': REQ_TASK
			};

		default:
			return false;
	}

	return true;
}

// checking the Abort's timeout
function checkAbortTimeout(){
	var now = Date.now();
	var _abort = global._Abort;
	var _timeout = 600 * 1000;
	if(_abort && _abort.size)
	{
		for(let m of _abort)
		{
			if(m[1] + _timeout < now)
			{
				_abort.delete(m[0]);
			}
		}
	}
}
/**
 * 格式化文件大小
 */
function formatSize(size)
{
	var list = ['GB', 'MB', 'KB'];
	var unit = 'Byte';
	while (size > 2048 && list.length)
	{
		size /= 1024;
		unit = list.pop();
	}

	return size.toFixed(2) + ' ' + unit;
}

// init and setup the admin server manager
admin.initClient(PROC_ID, PROC, adminCommand);
PROC.on(CONST.MSG_REQ, admin.onAdminMessage);