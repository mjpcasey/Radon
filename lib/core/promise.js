/**
 * @file promise实现
 */
var util = require('./util');
var async = ('object' == typeof process) ? process.nextTick : setTimeout;

// promise util function
function PromiseWithContext(fn, succ, fail)
{
	var self = this;
	self._status = 0;
	self._data = null;
	// callback on success
	self._succ = succ;
	// callback on fail
	self._fail = fail;
	// next child promises
	self._next = null;
	// callback runtime
	self._context = null;

	if (fn)
	{
		if (fn !== true)
		{
			fn(self.resolve.bind(self), self.reject.bind(self));
		}
		// save current runtime object
		self._context = util.getContext();
	}
}
module.exports = PromiseWithContext;

PromiseWithContext.prototype._runNext = function(status, data) {
	var self = this;
	if (!self._status)
	{
		self._status = status ? 'resolve' : 'reject';
		self._data = data;
	}

	if (self._next && self._next.length)
	{
		var next;
		while (next = self._next.shift())
		{
			// pass current runtime to next promise
			next._context = self._context;
			next[self._status](self._data);
		}
	}
	else if (status == 'reject')
	{
		// no exception process callback, throw to system
		throw data;
	}
};

PromiseWithContext.prototype._pushNext = function(next) {
	var self = this;

	if (self._status)
	{
		next[self._status](self._data);
	}
	else
	{
		if (self._next)
		{
			self._next.push(next);
		}
		else
		{
			self._next = [next];
		}
	}
};

PromiseWithContext.prototype._runCallback = function(status, data) {
	var self = this;
	var cb = status ? self._succ : self._fail;

	if (cb)
	{
		try {
			var ct = util.setContext(self._context);
			data = cb(data);
			status = 1;
			self._context = util.setContext(ct);

		}catch (err) {
			status = 0;
			data = err;
		}
	}

	if (data && 'function' == typeof data.then)
	{
		//console.log('promise call promise', data);
		data.then(
			self._runNext.bind(self, 1),
			self._runNext.bind(self, 0)
		);
	}
	else {
		self._runNext(status, data);
	}
};

PromiseWithContext.prototype.resolve = function(data) {
	var self = this;
	async(
		function()
		{
			self._runCallback(1, data);
		}
	);
	return self;
};

PromiseWithContext.prototype.reject = function(err) {
	var self = this;
	async(
		function()
		{
			self._runCallback(0, err);
		}
	);
	return self;
};

PromiseWithContext.prototype.then = function(succ, fail) {
	var self = this;
	var next = new PromiseWithContext(null, succ, fail);

	self._pushNext(next);
	return next;
};

PromiseWithContext.prototype.catch = function(fail) {
	var self = this;
	var next = new PromiseWithContext(null, null, fail);

	self._pushNext(next);
	return next;
};

PromiseWithContext.resolve = function(data)
{
	if (data && 'function' == typeof data.then)
	{
		return data;
	}
	return (new PromiseWithContext(true)).resolve(data);
}

PromiseWithContext.reject = function(error)
{
	return (new PromiseWithContext(true)).reject(error);
}


// wait all promise done
function waitAll(events)
{
	var self = this;
	self._datas = [];
	self._error = null;
	self._wait = events.length;
	self._next = [];

	var onReject = self._onReject.bind(self);
	var evt;
	for (var i = events.length; i --> 0;)
	{
		evt = events[i];
		if (evt && evt.then instanceof Function)
		{
			evt.then(self._onResolve.bind(self, i), onReject);
		}
		else
		{
			self._datas[i] = evt;
			self._wait--;
		}
	}
}

waitAll.prototype.then = function(succ, fail)
{
	var self = this;
	var next = new PromiseWithContext(true, succ, fail);
	self._next.push(next);

	self._emit();
	return next;
};
waitAll.prototype._emit = function()
{
	var self = this;
	if (self._next.length <= 0)
	{
		return;
	}
	var next;
	if (self._wait < 0)
	{
		while (next = self._next.shift())
		{
			next.reject(self._error);
		}
	}
	else if (self._wait == 0)
	{
		while (next = self._next.shift())
		{
			next.resolve(self._datas);
		}
	}
};
waitAll.prototype._onResolve = function(idx, data)
{
	var self = this;
	self._datas[idx] = data;
	self._wait--;
	self._emit();
};
waitAll.prototype._onReject = function(err)
{
	var self = this;
	self._wait = -1;
	self._error = err;
	self._emit();
}

PromiseWithContext.all = function(promises)
{
	return new waitAll(promises);
}