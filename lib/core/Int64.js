/**
 * @file Int64拓展
 */
"use strict";
var Long = require('mongodb').Long;
/* Int64 类型处理类 */
function Int64() {
	if(arguments.length === 1) {
		var str = arguments[0];
		var radix = 10;
		if(!str.indexOf('0x')) {
			str = str.slice(2);
			radix = 16;
		}
		return Long.fromString(String(str), radix);
	}
	else {
		return new Long(arguments[0], arguments[1]);
	}
}

Int64.isInt64 = function(v) {
	return v instanceof Int64 || v instanceof Long;
};


var _mark = 0x100000000;
var _max = 0x7fffffff;
Int64.toString = function(int64)
{
	var h = int64.getHighBits();
	var l = int64.getLowBits();
	if (l < 0)
	{
		l += _mark;
	}

	if (h == 0)
	{
		return l.toString(16);
	}
	else
	{
		l += _mark;
		if (h < 0)
		{
			h += _mark;
		}
		return h.toString(16) + l.toString(16).slice(1);
	}
};

Int64.fromString = function(str)
{
	if(str.indexOf('#') === 0) {
		str = str.slice(1);
	}
	var l, h = 0;
	if (str.length > 8)
	{
		h = parseInt(str.slice(0,-8), 16);
		str = str.slice(-8);
	}

	l = parseInt(str, 16);

	if (l > _max)
	{
		l -= _mark;
	}
	if (h > _max)
	{
		h -= _mark;
	}

	return new Int64(l, h);
};


module.exports = Int64;