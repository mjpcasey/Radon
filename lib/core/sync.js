"use strict";

var util = require('./util');

var Sync = function(blocks, cb, exception) {
	if(!Array.isArray(blocks)) {
		blocks = [blocks];
	}

	var async = new Async(blocks, cb, exception);
	process.nextTick(async._run.bind(async));

	return async;
};

module.exports = Sync;

var privateBreak = {};
function checkException(exception){
	if (exception === privateBreak){
		return 1;
	}
}
function triggerException(self, e){
	if (checkException.call(self, e)){
		return;
	}
	while (self._stack.length > 0) {
		var cb = self._stack.pop();
		if(cb) {
			try {
				self._in_call = true;
				var result = cb(e);
				self._in_call = false;
				return self._busy ? 0 : self._run(result);
			}catch (e2){
				if (checkException.call(self, e2)){
					return;
				}
				e = e2;
			}
		}
	}

	self._reject(e);
}

var Async = function(blocks, cb, exception)
{
	var self = this;
	self._blocks = blocks;
	self._block_num = 0;
	self._busy = false;
	self._pause = 0;
	self._in_call = false;
	self._result = null;
	self._callback = null;
	self._next = null;
	self._stack = null; // 错误回调栈.
	self._context = util.getContext();

	if (cb || exception)
	{
		self.then(cb, exception);
	}
};

Async.prototype.next = function(val) {
	this._run(val);
	if (this._in_call)
	{
		throw privateBreak;
	}
};

Async.prototype.done = function(val) {
	this._resolve(val);
	if (this._in_call)
	{
		throw privateBreak;
	}
};

Async.prototype.error = function(err) {
	this._reject(err);
	if (this._in_call)
	{
		throw privateBreak;
	}
};

Async.prototype._run = function(val) {
	var self = this;
	var blocks = self._blocks;
	var len = blocks.length;
	var fn;
	self._stack = [];
	try {
		// recover context
		var ct = util.setContext(self._context);
		while (!self._busy)
		{
			if (val && val.then instanceof Function)
			{
				val.then(
					self._run.bind(self),
					self._reject.bind(self)
				);
				break;
			}

			if (self._block_num >= len)
			{
				self._resolve(val);
				break;
			}

			fn = blocks[self._block_num++];
			if (fn instanceof Function)
			{
				self._in_call = true;
				val = fn.call(self, val);
				self._in_call = false;
			}
			else
			{
				val = fn;
			}
		}
		// restore context
		util.setContext(ct);
	}
	catch(e) {
		if (!checkException.call(self, e)){
			self._reject(e);
		}
	}
};

Async.prototype._resolve = function(data)
{
	var self = this;
	if (!self._result)
	{
		self._result = [1, data];
		if (self._callback)
		{
			self._callback[0](data);
		}
	}
};

Async.prototype._reject = function(err)
{
	var self = this;
	if (!self._result)
	{
		self._result = [0, err];
		if (self._callback)
		{
			self._callback[1](err);
		}
	}
};

Async.prototype.wait = function(events, wait_cb, exception_cb) {
	var self = this;
	if(self._busy) {
		throw new Error('操作方法错误,只能调用wait一次');
	}

	self._busy = true;
	self._stack.push(exception_cb);
	if(Array.isArray(events)) {
		events = util.promiseAll(events);
	}

	events.then(
		function(val)
		{
			self._busy = false;
			try {
				if(wait_cb) {
					self._in_call = true;
					val = wait_cb.call(self, val);
					self._in_call = false;
					if (self._busy){
						return;
					}
				}
				self._run(val);
			}
			catch (e) {
				triggerException(self, e);
			}
		},
		function(err)
		{
			self._busy = false;
			triggerException(self, err);
		}
	);
	throw privateBreak;
};

Async.prototype.do = function(blocks){
	var self = this;
	self._busy = true;
	return Sync(
		blocks,
		function(data){
			self._busy = false;
			self.next(data);
		},
		function(err){
			self._busy = false;
			triggerException(self, err);
		}
	);
};

Async.prototype.pause = function()
{
	var self = this;
	self._busy = true;
	self._pause++;
	return self;
};

Async.prototype.resume = function(data) {
	var self = this;
	switch (--self._pause){
		case 0:
			if (self._busy)
			{
				self._busy = false;
				self._run(data);
			}
			break;
		case -1:
			self._pause = 0;
			break;
	}
};

Async.prototype.then = function(succ, fail)
{
	var self = this;
	if (!self._next)
	{
		self._next = util.promise(
			function(done, fail)
			{
				if (self._result)
				{
					(self._result[0] ? done : fail)(self._result[1]);
				}
				else
				{
					self._callback = [done, fail];
				}
			}
		);
	}
	return self._next.then(succ, fail);
};