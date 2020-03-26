/**
 * Radon Cluster Process Module
 */
"use strict";
var radon = require('./radon');
var child = require('./core/child');
var CONST = require('./core/const');
var admin = require('./modules/admin.js');
var util = radon.util;
var normalizePath = util.normalizePath;
var log = util.log;
var MAX;

var MQ = [];
// 捕获未知异常，并将日志发送至主进程 caught unknow exceprion, and send log to master process
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

// process system signal event
process.on('SIGINT', function()
{
	log(1, 'Cluster Process [%s] killed with SIGINT..', PROC_ID);
	// stop worker process
	for (var pair of THREADS)
	{
		log(1, 'Killing Cluster Process %d..', pair[0]);
		pair[1].thread.stop('SIGINT');
	}

	process.kill(process.pid, 'SIGKILL');
});

// init ipc process object
var inited = false;
var init_data = null;
var PROC_ID = radon.getCmdParam('id');
var PROC_NAME = '';
var PROC_DAEMON = '';
var PROC = new child.node(PROC_ID);

var THREADS = new Map();

// 接收守护进程消息，初始化该子进程
PROC.on(CONST.MSG_INIT, function(data){
	// init process once
	if (inited){
		return;
	}
	inited = true;
	init_data = data;

	// init radon environment
	radon.init(data);
	PROC_NAME = data.process;
	PROC_DAEMON = data.daemon;
	log(0, 'Cluster Process Inited (%s)', PROC_ID);

	// use remote log out
	util.setLogCallback(remoteLog);

	PROC.on(CONST.MSG_IPC, onDaemonMessage);

	// loading process config
	var config = radon.config('radon.processes.' + PROC_NAME);
	MAX = config.thread_queue || 5;

	// start worker thread
	var thread_count = config.threads || 0;
	var thread_queue = [];
	var base_pid = process.pid * 100000 + Math.round(10000 * Math.random());
	var script = process.execArgv.concat(
		(config.execArgv || []),
		normalizePath('@radon/lib/process.js')
	);

	// append the addon process arguments
	var i;
	for (i = 2; i < process.argv.length; i++)
	{
		if (process.argv[i].slice(0, 3) != 'id:')
		{
			script.push(process.argv[i]);
		}
	}

	for (i = 0; i < thread_count; i++)
	{
		thread_queue.push(
			startWorker(base_pid + i, script, data)
		);
	}

	// notify thread start event
	util.promiseAll(thread_queue).then(
		function(threads)
		{
			PROC.send(CONST.MSG_INITED, [process.pid, data]);
		},
		function(err)
		{
			log(4, 'Child Thread Start Error:\n%s', (err && err.stack) || err);
		}
	);
});

// 守护进程的管理消息
PROC.on(CONST.MSG_SYS, util.generator(function *(data){
	var type = data[0];
	var param = data[1];
	var waits = [];

	switch (type)
	{
		// refresh config cache
		case 'reload':
			util.reload_config();
			log(1, 'Process %s config cache updated.', PROC_ID);
			break;

		// request to clear jobs, after done, send the MSG_CLEAR back
		case 'clear':
			// pass request to all child processes
			for (var pair of THREADS)
			{
				log(1, 'Stopping Cluster Process %s.%d..', PROC_ID, pair[0]);
				waits.push(
					waitChildProcess(pair[1].thread, data, CONST.MSG_CLEAR)
				);
			}

			// wait child processes all clear
			yield Promise.all(waits);

			// send notify to parent process notify status clear
			PROC.send(CONST.MSG_CLEAR, process.pid);
			break;

		// clear jobs and exit process
		case 'stop':
			// pass request to all child processes
			for (var pair of THREADS)
			{
				log(1, 'Exiting Cluster Process %s.%d..', PROC_ID, pair[0]);
				pair[1].thread.setAutoRestart(false);
				waits.push(
					waitChildProcess(pair[1].thread, data, 'exit')
				);
			}

			// wait child processes exit
			yield Promise.all(waits);

			// all child processes exited, exit current process
			process.kill(process.pid, 'SIGKILL');
			break;
	}
}));
/* 等待该进程的thread子进程完成 */
function waitChildProcess(proc, data, event)
{
	return new Promise(function(done, fail){
		try
		{
			proc.once(event, done);
			proc.send(CONST.MSG_SYS, data);
		}
		catch (err)
		{
			fail(err);
		}
	})
}


// 异步开启多个thread进程
function startWorker(idx, script, param)
{
	var thread;
	var thread_id = PROC_DAEMON + '.' + PROC_NAME + '.' + idx;

	return util.promise(function(done, fail) {
		try {
			thread = new child.process(thread_id, script, param);

			// bind the message event
			thread.on(CONST.MSG_IPC, onThreadMessage.bind(thread, idx, thread_id));
			thread.on(CONST.MSG_EXCEPTION, onThreadException.bind(thread));
			thread.on(CONST.MSG_LOG, onThreadLog.bind(thread));
			thread.on(CONST.MSG_ACK, bypassSystemAdminMessage);

			// wait the process start finish then done the promise
			thread.once(CONST.MSG_INITED, done);
			thread.once('exit', fail);

			// cache the thread object
			THREADS.set(idx, {'thread': thread, 'active': 0, 'time': 0});

			// start thread process
			thread.start(false);
		}
		catch (err)
		{
			fail(err);
		}
	})
	.then(
		function(data)
		{
			thread.removeAllListeners('exit');
			thread.setAutoRestart(true);
			return thread;
		},
		function(err)
		{
			if (Array.isArray(err))
			{
				radon.throw(3006, err);
			}
			else
			{
				throw err;
			}
		}
	);
}


// 接收守护进程通过IPC发送过来的数据消息-之后分发给指定的某一子进程
function onDaemonMessage(message)
{
	var thread;
	var header = message[0];

	// restore the reply message id format
	// get the relative thread object
	if (header.rext)
	{
		thread = THREADS.get(header.rext);
		if(thread)
		{
			// update the load balance data
			thread.time = Date.now();
			if (header.type == 'req')
			{
				thread.active++;
			}

			// pass the message to the thread
			thread.thread.send(CONST.MSG_IPC, message);
		}
	}
	else
	{
		MQ.push(message);
		sendThreadMsg();
	}
}
/* 多个thread节点处理的负载均衡 */
function sendThreadMsg()
{
	var message = MQ.shift();
	if(message)
	{
		var thread;
		var header = message[0];

		if(header.type == 'abort' || header.type == 'process_cast')
		{
			for(var thr of THREADS)
			{
				thr[1].thread.send(CONST.MSG_IPC, message);
			}

			return;
		}

		// none thread object found, pick one by load balance
		//ThreadMsgQuene

		for (var pair of THREADS)
		{
			switch (true)
			{
				// 初始化
				case !thread:
					thread = pair[1];
					break;
				// 已经封顶的情况下也不需要切。
				case pair[1].active === MAX:
					break;
				// 0记录最高优先级
				case thread.active === 0 && pair[1].active !== 0:
					break;
				// acitve 小或 time 小 都切
				case thread.active > pair[1].active || thread.time > pair[1].time:
					thread = pair[1];
					break;
				// 如果active 相同 则时小为主
				case thread.active === pair[1].active && thread.time > pair[1].time:
					thread = pair[1];
					break;
			}
		}

		if(thread && thread.active < MAX)
		{
			// update the load balance data
			thread.time = Date.now();
			if (header.type == 'req')
			{
				thread.active++;
			}

			// pass the message to the thread
			try
			{
				thread.thread.send(CONST.MSG_IPC, message);
			}
			catch(e)
			{
				// 发现错误，重发
				MQ.unshift(message);
			}
		}
		else
		{
			MQ.unshift(message);
		}
	}
}

// thread子进程通过IPC发送过来的信息转发到守护进程
function onThreadMessage(index, source_process, message)
{
	var thread = THREADS.get(index);
	if (thread)
	{
		// rewrite the header message id
		var header = message[0];
		header.ext = index;

		//console.log('back: ',header)
		// if request ack or pass out a request, decrease the counter
		if (header.type == 'ack' ||
			(header.type == 'req' && header.source_process != PROC_NAME))
		{
			thread.active--;
			sendThreadMsg();
		}
	}

	// resend to the daemon process
	PROC.send(CONST.MSG_IPC, message);
}
// 发送thread子进程异常给守护进程
function onThreadException(exception)
{
	PROC.send(CONST.MSG_EXCEPTION, exception);
}
// 发送thead子进程日志给守护进程
function onThreadLog(log)
{
	PROC.send(CONST.MSG_LOG, log);
}

// 发送该进程的本地日志消息给守护进程
function remoteLog(level, args)
{
	PROC.send(CONST.MSG_LOG, [level, args]);
}

// init and setup the admin server manager
admin.initClient(PROC_ID, PROC);
/* 转发守护进程发送过来的[MSG_REQ]消息给子进程thread和admin管理后台*/
PROC.on(
	CONST.MSG_REQ,
	function(message)
	{
		if (message.id == PROC_ID)
		{
			// call current process
			return admin.onAdminMessage(message);
		}
		else if (!message.id)
		{
			// cast message to all process
			// trigger current process first
			admin.onAdminMessage(message);

			// pass the message to the next process
			for (var pair of THREADS)
			{
				pair[1].thread.send(CONST.MSG_REQ, message);
			}
		}
		else
		{
			// pass the message to the specified process
			for (var pair of THREADS)
			{
				if (pair[1].thread.getName() == message.id)
				{
					pair[1].thread.send(CONST.MSG_REQ, message);
					return;
				}
			}

			// no process found
			admin.replyRequest(message.mid, 11, 'processes not found');
		}
	}
);
/* 转发子进程thread发送过来的[MSG_REQ]消息给守护进程 */
function bypassSystemAdminMessage(message)
{
	PROC.send(CONST.MSG_ACK, message);
}