/**
 * Radon Daemon Module
 * ---------------------
 * Read config file, start and monitoring the worker process
 * Only run on Node.JS env
 *
 * process message type
 * 	ipc - process message
 * 	sys - daemon manager process message
 * 	clear - process clear data, ready to shutdown message
 */
"use strict";
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var util = require('./core/util');
var child = require('./core/child');
var error = require('./core/error');
var CONST = require('./core/const');
var admin = require('./modules/admin.js');
var log = util.log;
var normalizePath = util.normalizePath;
var serialize = require('./core/serialize');

var debugPort = 0;
var debugFor = 0;
var monitorPort = 9527;

(function parseDebugConf(argString) {
	var match = null;
	(match = argString.match(/debug_start_port:(\d+)/)) && (debugPort = +match[1]);
	(match = argString.match(/debug_for:(\d+)/)) && (debugFor = +match[1]);
	(match = argString.match(/monitor_port:(\d+)/)) && (monitorPort = +match[1]);
})(process.argv.join());

// daemon groups cache object
var GROUPS = {};

function exit(code, message){
	var args = Array.prototype.slice.call(arguments);
	args[0] = 4;
	args[1] = 'DEAMON ERROR: '+message;
	log.apply(util, args);
	process.exit(code);
}

exports.runCommand = function(command, config){
	switch (command)
	{
		case 'reload':
		case 'restart':
			return cmdNotifyServer(config, command);
		case 'stop':
			return cmdStopKillServer(config, 'SIGTERM');
		case 'kill':
			return cmdStopKillServer(config, 'SIGINT');
		case 'monitor':
			return cmdStopKillServer(config, config.signal.toUpperCase(), config.target_pid);
		case 'status':
			return cmdStatusServer(config);
	}
}


// stop the daemon server process
// exit code
//   0 - exit ok
//   1 - not running
//   2 - pid process not match name
//   3 - stop wait timeout
//   * - another error
function cmdStopKillServer(config, signal, id)
{
	var info = getProcessInfo(config);
	if (!info)
	{
		console.error('Miss app_name and pid param.');
		return process.exit(3);
	}
	var name = info.name;
	var pid = info.pid;

	// check the process
	var code = checkProcess(name, pid);
	switch (code)
	{
		case 0:
			process.kill(id || pid, signal);
			if(!id)
			{
				process.stdout.write(`Stopping Daemon Server ${name}..`);
				// waitting process exit
				var timeout = Date.now() + 60000;
				setInterval(
					function()
					{
						var code = checkProcess(name, pid);
						if (code == 1)
						{
							// process not exists, kill ok
							process.stdout.write(' OK\n');
							process.exit(0);
						}
						else if (Date.now() > timeout)
						{
							// wait timeout
							process.stdout.write(` Failure [${code}]\n`);
							process.exit(3);
						}
						else
						{
							process.stdout.write('.');
						}
					},
					1000
				);
			}
			return;
		case 1:
			console.error('Daemon Server %s not running.', name);
			break;
		case 2:
			console.error('Daemon Server %s process not match.', name);
			break;
		default:
			console.error("Error: Can't query the daemon process status.");
			break;
	}

	process.exit(code);
}

function cmdNotifyServer(config, command)
{
	var info = getProcessInfo(config);
	if (!info)
	{
		console.error('Miss app_name and pid param.');
		return process.exit(3);
	}
	var name = info.name;
	var pid = info.pid;

	// check the process
	var code = checkProcess(name, pid);
	switch (code)
	{
		case 0:
			process.kill(
				pid,
				(command == 'restart' ? 'SIGBREAK' : 'SIGPIPE')
			);
			process.stdout.write(`Daemon Server ${name} ${command}ing..`);
			break;
		case 1:
			console.error('Daemon Server %s not running.', name);
			break;
		case 2:
			console.error('Daemon Server %s process not match.', name);
			break;
		default:
			console.error("Error: Can't query the daemon process status.");
			break;
	}

	process.exit(code);
}

function cmdStatusServer(config)
{
	var info = getProcessInfo(config);
	if (!info)
	{
		console.error('Miss app_name and pid param.');
		return process.exit(3);
	}
	var name = info.name;
	var pid = info.pid;

	// check the process
	var code = checkProcess(name, pid);
	switch (code)
	{
		case 0:
			console.log('Daemon Server %s is running.', name);
			break;
		case 1:
			console.log('Daemon Server %s not running.', name);
			break;
		case 2:
			console.log('Daemon Server %s process not match.', name);
			break;
		default:
			console.error("Error: Can't query the daemon process status.");
			break;
	}
}
/**
 * 获取daemon进程的进程信息
 * 
 * @param {Object} config -daemon配置
 */
function getProcessInfo(config)
{
	var daemon = config.daemon;
	var argv = util.parseCommandLine();
	var name = argv.title || (daemon && daemon.app_name) || false;
	var pid  = argv.pid || 0;

	if (!pid && daemon && daemon.pidfile)
	{
		// load process id from pid file
		try {
			pid = fs.readFileSync(
				daemon.pidfile,
				{encoding: 'utf8'}
			).trim();
		}
		catch (err) {}
	}

	if (!pid || !name)
	{
		return false;
	}
	else
	{
		return {
			'pid': +pid,
			'name': name
		};
	}
}
/**
 * 检查进程是否存在
 * 
 * @param {String} name -进程名称
 * @param {Number} pid -进程ID
 * @returns {Number} 0-存在 2-不存在
 */
function checkProcess(name, pid)
{
	// get process name
	try {
		var info = child_process.execSync(
			'ps -p ' + pid + ' -o command=',
			{'encoding': 'utf8'}
		);
	}
	catch (err)
	{
		// process not exists
		return err.status;
	}

	// check process name is matching
	info = info.trim().split(' ');
	if (~info.indexOf(name) && ~info.indexOf('pid#' + pid))
	{
		// matching, send kill signal to the process
		return 0;
	}
	else
	{
		// not matching process title
		return 2;
	}
}


/**
 * 开启radon后台管理服务器-查看radon进程的相关信息
 * 
 * @param {Object} config -admin server的配置
 */
exports.startAdminServer = function(config)
{
	if (!config.http_root)
	{
		config.http_root = require('path').normalize(
			__dirname + '/../resources/admin_http'
		);
	}
	if (!config.id)
	{
		config.id = 'DAEMON_MAIN';
	}

	if(monitorPort)
	{
		config.monitor_port = monitorPort;
	}
	// start the server
	admin.startWebServer(config);
};

/**
 * 强制杀死子进程
 * 
 * @param {Boolean} do_exit -是否执行当前任务后退出deamon守护进程
 */
exports.kill = util.generator(function *(do_exit)
{
	var procs = getProcess();
	var queue = [];
	var proc;

	// send kill signal to the child process
	for (proc of procs)
	{
		log(1, 'Killing Process [%s]...', proc.getName());
		queue.push(termProcess(proc, true));
	}

	// wait all process exited
	yield Promise.all(queue);

	if (do_exit)
	{
		// exit daemon process
		log(1, 'Daemon Server Process exited');
		process.exit(0);
	}
	else
	{
		return true;
	}
});

/**
 * admin send halt request to all child process
 * wait child process ready to halt
 * all process ready, send exit request to all child process
 * child process exit
 */
exports.stop = util.generator(function *()
{
	var procs = getProcess();
	var queue = [];
	var proc;

	// request child process to get ready for stop
	for (proc of procs)
	{
		log(1, 'Stopping Process [%s]...', proc.getName());
		queue.push(shutdownProcess(proc));
	}

	// wait all process to ready stop
	yield Promise.all(queue);

	// request child process to shutdown
	queue = [];
	for (proc of procs)
	{
		queue.push(termProcess(proc));
	}

	// wait all process to exit
	yield Promise.all(queue);

	// exit current process
	log(1, 'Daemon Process Stoped.');
	process.exit(0);
});

/**
 * 重启所有进程
 */
exports.restart = util.generator(function *()
{
	var procs = getProcess();
	var queue = [];

	// request child process to get ready for stop
	for (var proc of procs)
	{
		log(1, 'Restarting Process [%s]...', proc.getName());
		queue.push(termProcess(proc));
	}

	// wait all process to ready stop
	yield Promise.all(queue);

	// exit current process
	log(1, 'Daemon Process Restarted.');
	return true;
});

/**
 * reload the process config data
 * @param {Number} id -进程id
 */
exports.reload = function(id)
{
	if (id === 0)
	{
		// reload current daemon process
		util.reload_config();
		log(1, 'Daemon config cache updated.');
	}
	else
	{
		// request child process to get ready for stop
		var procs = getProcess();
		for (var proc of procs)
		{
			if (isProcess(proc, id))
			{
				proc.send(CONST.MSG_SYS, ['reload', id]);
			}
		}
	}
}
/**
 * 启动所有的服务进程
 * 
 * @param {Array} group_config  	-需要daemon进程守护管理的进程组配置
 * @param {Object} daemon_config 	-daemon进程配置
 * @param {Object} admin_config		-管理服务配置
 */
exports.start = function(group_config, daemon_config, admin_config)
{
	if (daemon_config)
	{
		// check config, generate pid file
		if (daemon_config.pidfile)
		{
			var mkdirp = dir => {
				if (!fs.existsSync(dir)) {
					mkdirp(path.dirname(dir));
					fs.mkdirSync(dir);
				}
			};
			mkdirp(path.dirname(daemon_config.pidfile));

			fs.writeFileSync(daemon_config.pidfile, process.pid);
		}

		// set process title
		var title = daemon_config.app_name || process.argv[1];
		title += ' pid#' + process.pid;
		if (daemon_config.hash_file)
		{
			try {
				var hash = fs.readFileSync(
					daemon_config.hash_file,
					{encoding: 'utf8'}
				);
				if (hash)
				{
					title += ' git#' + hash.trim();
				}
			}
			catch (err) {}
		}
		process.title = title;

		// set process uid and gid
		if (process.setuid)
		{
			if (daemon_config.group)
			{
				process.setgid(daemon_config.group);
			}
			if (daemon_config.user)
			{
				process.setuid(daemon_config.user);
			}
		}

		// check if need to log to the logfile
		if (daemon_config.log_file)
		{
			logStdio('App', process.stdout, daemon_config.log_file);
		}
		if (daemon_config.log_error)
		{
			logStdio('Error', process.stderr, daemon_config.log_error);
		}
	}

	// init the admin setting
	admin.init(exports);

	if (admin_config)
	{
		// start up the admin server
		exports.startAdminServer(admin_config);
	}

	// start the daemons process
	if (group_config instanceof Array)
	{
		group_config.forEach(startGroup);
	}
	else
	{
		startGroup(group_config);
	}
}
/**
 * 开启某一进程组
 * 
 * @param {Object} group -一组带守护的进程配置
 */
function startGroup(group)
{
	var name = group.name;
	var conf = group.config;
	// read daemon config, get all process list
	log(1, 'Starting Daemon: %s  [config_file: %s]', name, conf);

	if (GROUPS[name]){
		exit(205, 'Daemon Name Existed. (%s)', name);
	}

	var config = util.config(conf, 'radon');
	if (!config){
		exit(200, 'Config File Missed or File Error. (%s)', conf);
	}
	// check config param
	if (!config.processes){
		exit(202, 'Config File Error. miss "processes" setting.');
	}
	if (!config.process_file){
		exit(203, 'Config File Error. miss "process_file" setting.');
	}
	// set process script file path
	var script = normalizePath(config.process_file);
	if (!fs.existsSync(script)){
		exit(204, 'Process Script File Missed! (%s)', script);
	}

	// 处理单进程模式, 替换变量内容
	if (group.single_mode) {
		config.processes = {
			'SINGLE_MODE': {
				'execArgv': group.single_argv || []
			}
		};
	}

	var daemon = GROUPS[name] = {
		'name': name,
		'status': 'stop',
		'config_file': conf,
		'single_mode': !!group.single_mode,
		'config': config,
		'options': (group.options || []),
		'script': script
	};

	// process child process uid and gid
	if (process.getuid)
	{
		try
		{
			if (group.user)
			{
				daemon.uid = +(/^\d+$/.test(group.user) ?
					group.user :
					child_process.execSync(
						'id -u ' + group.user
					).toString().trim()
				);
			}
			if (group.group)
			{
				daemon.gid = +(/^\d+$/.test(group.group) ?
					group.group :
					child_process.execSync(
						'id -g ' + group.group
					).toString().trim()
				);
			}
		}
		catch (err){}
	}

	log(
		0, 'Daemon Config:\n\tscript: %s\n\tprocess: %s',
		script,
		Object.keys(config.processes)
	);

	delayStartProcess(daemon);
}

var _process_queue = [];
var _process_waiting = false;
function delayStartProcess(daemon)
{
	if (daemon.status == 'stop')
	{
		daemon.status = 'running';
		daemon.processes = {};

		// starting child process
		var proc, param, ch, config, script, args;
		for (proc in daemon.config.processes){
			config = daemon.config.processes[proc];
			param = {
				'daemon': daemon.name,
				'process': proc,
				'config_file': daemon.config_file,
				'single_mode': daemon.single_mode,
				'debug': util.get_debug(),
				'monitor_port': monitorPort,
				'app_root': normalizePath('/').slice(0,-1)
			};

			if (daemon.uid || daemon.uid === 0)
			{
				param.uid = daemon.uid;
			}
			if (daemon.gid || daemon.gid === 0)
			{
				param.gid = daemon.gid;
			}

			// check if
			if (config.file)
			{
				script = normalizePath(config.file);
				if (!fs.existsSync(script)){
					exit(204, 'Process Script File Missed! (%s)', script);
				}
			}
			else
			{
				script = daemon.script;
			}

			// Support Process Execution arguments
			if(config.execArgv)
			{
				script = config.execArgv.concat(script);
			}
			// append the addon process arguments
			args = daemon.options.concat(script);

			for (var i = 2; i < process.argv.length; i++)
			{
				if (process.argv[i].slice(0, 3) != 'id:')
				{
					args.push(process.argv[i]);
				}
			}

			ch = new child.process(daemon.name+'.'+proc, args, param);

			daemon.processes[proc] = ch;
			ch.on(CONST.MSG_EXCEPTION, onChildProcessException.bind(daemon));
			ch.on(CONST.MSG_IPC, onChildProcessMessage.bind(daemon, ch));
			ch.on(CONST.MSG_LOG, onChildProcessLog.bind(daemon, ch));
			ch.on(CONST.MSG_ACK, admin.onClientMessage.bind(daemon, ch));

			_process_queue.push(ch);
		}
	}

	// start queued process
	if (!_process_waiting && _process_queue.length)
	{
		_process_waiting = true;
		process.nextTick(startProcess);
	}
}
/**
 * 启动队列中的所有进程
 */
function startProcess(data)
{
	if (_process_queue.length)
	{
		var proc = _process_queue.shift();
		var debugParam;
		if (debugPort && debugPort++ && (!debugFor || debugPort === debugFor))
		{
			debugParam = `--debug=${debugPort}`;
		}

		// process init finish, start next process
		proc.once(CONST.MSG_INITED, startProcess);
		proc.start(null, debugParam);
	}
	else
	{
		_process_waiting = false;
	}
}
/**
 * 获取radon的所有进程
 * 
 * @returns {Array} 所有的进程集合
 */
function getProcess()
{
	var procs = [];

	// request daemon group process to get ready for stop
	var tmp, proc;
	for (tmp in GROUPS)
	{
		tmp = GROUPS[tmp].processes;
		if (tmp)
		{
			for (proc in tmp)
			{
				procs.push(tmp[proc]);
			}
		}
	}

	return procs;
}
exports.getProcess = getProcess;
/**
 * 是否是该进程
 */
function isProcess(proc, id)
{
	if (id)
	{
		var name = proc.getName();
		if (name != id && id.indexOf(name) !== 0)
		{
			return false;
		}
	}
	return true;
}
/**
 * request to clear jobs, after done, send the MSG_CLEAR back
 */
function shutdownProcess(proc, data)
{
	return new Promise(function(done, fail){
		proc.once(CONST.MSG_CLEAR, done);
		proc.send(CONST.MSG_SYS, ['clear', data]);
	});
}
/**
 * 整理进程退出时需要发送的消息信号
 * 
 * @param {ChildProcess} proc 子进程管理类 lib/core/child.js#ChildProcess
 * @param {Boolean} kill 是否杀掉进程
 */
function termProcess(proc, kill)
{
	return new Promise(function(done, fail){
		proc.once('exit', done);
		if (kill)
		{
			proc.stop('SIGINT');
		}
		else
		{
			proc.setAutoRestart(false);
			proc.send(CONST.MSG_SYS, ['stop']);
		}
	});
}

/**
 * IPC内部通信消息事件监听转发
 * 		arort 类型，向所有进程广播消息
 *		process_name 为 数组/字符串，向 多个/单个 目标进程/广播消息
 *		所有不满足时，按req失败处理
 * @param {*} source_process -源进程管理对象
 * @param {Array} message -发送的消息信息
 */
function onChildProcessMessage(source_process, message)
{
	var header = message[0];
	var process_name = (this.single_mode ? 'SINGLE_MODE' : header.process);

	// abort type, cast message to all processes
	// 
	if(header.type == 'abort')
	{
		for(let proc in this.processes)
		{
			if(this.processes.hasOwnProperty(proc))
			{
				this.processes[proc].send(CONST.MSG_IPC, message);
			}
		}

		return;
	}

	if (Array.isArray(process_name))
	{
		// cast message to multiply processes
		var has_process = false;
		var processes = process_name;
		for (var i = 0; i < processes.length; i++)
		{
			process_name = processes[i];
			if (this.processes[process_name])
			{
				header.process = process_name;
				this.processes[process_name].send(CONST.MSG_IPC, message);
				has_process = true;
			}
		}
		if (has_process)
		{
			return;
		}
	}
	else if (this.processes[process_name])
	{
		// found target process, send the message to the process
		this.processes[process_name].send(CONST.MSG_IPC, message);
		return;
	}

	if (header.type == 'req')
	{
		// no process found, reply error for request message
		var res_header = {
			'type': 'ack',
			'source_process': 0, // daemon message process
			'source_module': 0, // daemon message module
			'process': header.source_process,
			'module': header.source_module,
			'rpid': header.pid,
			'rid': header.mid,
			'rext': header.ext,
			'err': 1
		};

		var data = serialize.rawEncode({
			'success': false,
			'code': 3001,
			'message': error.message(3001, [process_name])
		});

		source_process.send(CONST.MSG_IPC, [res_header, data]);
	}
}
/**
 * 自定义的子进程异常消息监听函数
 */
function onChildProcessException(data){
}
/**
 * 自定义的子进程LOG信息监听处理
 */
function onChildProcessLog(source_process, log)
{
	var fn = (log[0] % 5) == 4 ? console.error : console.log;
	fn.apply(console, log[1]);
}

/* hook stdio stream output into the log file */
function logStdio(name, io, path)
{
	var io_write = io.write;
	var output = !~process.argv.indexOf('--quite');
	var old = util.date('Ymd', new Date());
	var stream;
	io.write = function()
	{
		// output to origin stdio stream
		if (output)
		{
			io_write.apply(this, arguments);
		}

		var now = util.date('Ymd', new Date());
		if(old != now)
		{
			old = now;
			stream && stream.end();
			stream = null;
		}

		if(!stream)
		{
			var file = `${path}${now}.log`;
			stream = fs.createWriteStream(file, {'flags': 'a'});
			stream.on(
				'error',
				function()
				{
					io.write = io_write;
					log(4, 'Open daemon %s log file error: %s', name, file);
				}
			);
		}

		// log data to log file stream
		stream.write.apply(stream, arguments);
	};

	log(1, '%s loging into file: %s', name, path);
}
