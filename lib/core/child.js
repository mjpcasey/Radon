/**
 * @file Radon Child Process Module
 * ----------------------
 * Manager the child process start and ipc message
 */

"use strict";
var fs = require('fs');
var child_process = require('child_process');
var EventEmitter = require('events').EventEmitter;
var serialize = require('./serialize');
var radon = require('../radon');
var util = require('./util');
var CONST = require('./const');
var normalizePath = util.normalizePath;
var log = util.log;

/**
 * 子进程管理类
 * 
 * @class
 * @constructor
 * @param {String} name   Process Name
 * @param {String} script Process Script File Path
 * @param {Object} param  Process Init Param Object
 */
function ChildProcess(name, script, param)
{
	this.$name = name;
	this.$param = param;
	this.$proc = null;
	this.$pipe_rx = null;
	this.$pipe_tx = null;
	this.$status = 'stop';
	this.$started = 0;
	// process exit logs
	this.$exits = [];

	// prepare the args
	if (Array.isArray(script))
	{
		this.$script = script.concat('id:' + name);
	}
	else
	{
		this.$script = [script, 'id:' + name];
	}

	// uid & gid
	this._uid = param.uid || undefined;
	this._gid = param.gid || undefined;

	EventEmitter.call(this);
}
/**
 * 启动一个子进程
 * 
 * @param {Boolean} auto_restart -是否自动重启
 * @param {debugOption} debugOption -进程启动时的额外命令行参数
 */
ChildProcess.prototype.start = function(auto_restart, debugOption)
{
	this.$status = (auto_restart === false) ? 'run_once' : 'run_auto';
	this.$started++;

	debugOption && this.$script.unshift(debugOption);

	// spawn new process
	var proc = this.$proc = child_process.spawn(
		process.execPath,
		this.$script,
		{
			'stdio': [
				process.stdin,
				process.stdout,
				process.stderr,
				'pipe',
				'pipe'
			],
			'uid': this._uid,
			'gid': this._gid
		}
	);
	this.$pipe_tx = proc.stdio[3];
	this.$pipe_rx = proc.stdio[4];

	this._buf = null;
	this._size = 0;
	this._wait = 0;

	// bind process event
	proc.on('exit', this.onExit.bind(this, proc.pid));
	this.$pipe_rx.on('data', recvPacket.bind(this));

	// send the process param data
	this.send(CONST.MSG_INIT, this.$param);
};
/**
 * kill 信号发送
 * 
 * @param {Number} pid -进程ID
 * @param {String|Number} signal -将发送的信号
 */
ChildProcess.prototype.stop = function()
{
	// set process status to stop
	this.$status = 'stop';
	// send kill signal to child process
	var proc = this.$proc;
	if (proc)
	{
		proc.kill.apply(proc, arguments);
	}
};
/**
 * 发送终止信号给当前子进程组的所有进程
 */
ChildProcess.prototype.isRunning = function()
{
	// send kill signal to child process
	var proc = this.$proc;
	if (proc)
	{
		try {
			return proc.kill(0);
		}
		catch (err) {}
	}

	return false;
};
/**
 * 设置启动方式是自动启动还是只启动一次
 * 
 * @param {Boolean} auto_restart -是否自动重启
 */
ChildProcess.prototype.setAutoRestart = function(auto_restart)
{
	if (auto_restart)
	{
		if (this.$status == 'run_once')
		{
			this.$status = 'run_auto';
		}
	}
	else
	{
		if (this.$status == 'run_auto')
		{
			this.$status = 'run_once';
		}
	}
};
/**
 * 进程退出事件绑定函数
 * 
 * @param {Number} pid -进程id
 * @param {Number} code -退出码
 * @param {String} signal -信号
 */
ChildProcess.prototype.onExit = function(pid, code, signal)
{
	var self = this;
	// process exit, log exit info
	// todo: log stderr output data
	self.$exits.unshift({
		'ts': Date.now(),
		'pid': pid,
		'code': code,
		'signal': signal
	});
	self.$exits.splice(100, 1);

	// self.$pipe_tx.end();
	self.$pipe_rx.removeAllListeners();
	self.$pipe_rx = self.$pipe_tx = null;

	// emit exit message
	self.emit('exit', [pid, code, signal]);

	log(
		4, 'ChildProcess Exited! (pid: %d, code: %d, signal: %s)',
		pid, code, signal
	);

	// check if need to restart process
	if (self.$status == 'run_auto')
	{
		self.start();
	}
	else
	{
		self.$status = 'stop';
		self.$proc = null;
	}
};

ChildProcess.prototype.onMessage = function(message, start)
{
	try {
		message = serialize.rawDecode(message, start);
	}catch (err){
		log(4, 'ChildProcess::onMessage() Decode Error (%s)', this.$name);
	}
	if (message){
		log(0, 'ChildProcess::onMessage() got message %s from (%s)', message[0], this.$name);
		this.emit(message[0], message[1]);
	}
};

ChildProcess.prototype.send = function(type, data)
{
	sendPacket(this.$pipe_tx, type, data, this);
};

/**
 * 返回进程id
 * @returns {Number} pid
 */
ChildProcess.prototype.getPid = function()
{
	if (this.$proc)
	{
		return this.$proc.pid || 0;
	}
	return 0;
};
/**
 * 返回该管理该进程的名称
 */
ChildProcess.prototype.getName = function()
{
	return this.$name;
}

/**
 * Client Node Process Class
 * 子节点类
 * 
 * @param {String} name <optional> process name
 */
function NodeProcess(name)
{
	this._buf = null;
	this._size = 0;
	this._wait = 0;

	this.$name = name || '';
	this.$std_tx = fs.createWriteStream('', {fd:4});
	this.$std_rx = fs.createReadStream('', {fd:3});
	this.$std_rx.on('data', recvPacket.bind(this));

	EventEmitter.call(this);
}
/* 消息处理 二次转发 */
NodeProcess.prototype.onMessage = function(message, start)
{
	try {
		message = serialize.rawDecode(message, start);
	}catch (err){
		return log(4, 'NodeProcess::onMessage() Decode Error (%s)', this.$name);
	}
	if (message){
		log(0, 'NodeProcess::onMessage() process (%s) got message %s', this.$name, message[0]);
		this.emit(message[0], message[1]);
	}
};
/* ipc底层send逻辑 */
NodeProcess.prototype.send = function(type, data)
{
	sendPacket(this.$std_tx, type, data, this);
};
/* 关闭该进程节点 */
NodeProcess.prototype.close = function(code)
{
	this.$std_tx.end();
	this.$std_rx.removeAllListeners();
	this.$std_tx = this.$std_rx = null;

	process.exit(code || process.exitCode);
};

// inherit EventEmitter Class
Object.keys(EventEmitter.prototype).forEach(
	function(prop)
	{
		ChildProcess.prototype[prop] = EventEmitter.prototype[prop];
		NodeProcess.prototype[prop] = EventEmitter.prototype[prop];
	}
);


/**
 * 发送数据，其他端通过监听该可写流实现发送
 * 
 * @param {*} stream 可写流
 * @param {*} type 消息类型
 * @param {*} data 传输的数据
 */
function sendPacket(stream, type, data, self)
{
	if (stream)
	{
		var packet = serialize.rawEncode([type, data]);
		var header = new Buffer(6);
		header.writeUIntLE(packet.length, 0, 6);
		stream.write(header);
		stream.write(packet);
	}
}
/**
 * 接收发送过来的数据包
 * 
 * @param {*} packet 数据包
 */
function recvPacket(packet)
{
	var self = this;
	var size = self._size + packet.length;
	var wait = self._wait;

	if (size >= (wait || 6))
	{
		var pos = 0;
		if (self._buf) {
			self._buf.push(packet);
			packet = Buffer.concat(self._buf);
			self._buf = null;
		}

		while (1)
		{
			if (wait > 0)
			{
				if (size < wait)
				{
					break;
				}

				try
				{
					self.onMessage(packet, pos);
				}
				catch (err)
				{
					log(
						4,
						'process emit message exception\n%s',
						err && err.stack || err
					);
				}

				pos += wait;
				size -= wait;
				wait = 0;
			}
			else if (size >= 6)
			{
				wait = packet.readUIntLE(pos, 6);
				pos += 6;
				size -= 6;
			}
			else
			{
				break;
			}
		}
		if (size > 0)
		{
			self._buf = [ packet.slice(pos) ];
		}
		self._wait = wait;
	}
	else if (self._buf)
	{
		self._buf.push(packet);
	}
	else {
		self._buf = [packet];
	}
	self._size = size;
}

/**
 * Export Class Function
 */
exports.process = ChildProcess;
exports.node = NodeProcess;
