/**
 * 数据序列化操作
 */
"use strict";

// use mongodb Long Class as default Int64 type class
var Int64 = require('./Int64');
var has = Object.prototype.hasOwnProperty;

// 序列化记录
function serialize(data){
	switch (typeof data){
		case 'string':
			return 's' + data.length + ':' + data + ';';
		case 'number':
			if (isNaN(data)){
				return 'N;';
			}else if (Number.isInteger(data)){
				return 'i' + data.toString(36) + ';';
			}else {
				return 'f' + data.toString() + ';';
			}
		case 'boolean':
			return 'b' + (data?1:0) + ';';
		case 'undefined':
			return 'u;';
		case 'object':
			var str, i;
			if (data === null)
			{
				return 'n;';
			}
			else if (Int64.isInt64(data))
			{
				return 'I' + Int64.toString(data) + ';';
			}
			else if (Buffer.isBuffer(data))
			{
				str = data.toString('base64');
				return 'B' + str + ';';
			}
			else if (data instanceof Date)
			{
				return 'd' + data.getTime().toString(36) + ';';
			}
			else if (data instanceof Array)
			{
				str = 'a';
				for (var i=0; i<data.length; i++){
					str += serialize(data[i]);
				}
			}
			else
			{
				if (data.toJSON instanceof Function)
				{
					data = data.toJSON();
					if ('object' != typeof data){
						return serialize(data);
					}
				}

				str = 'o';
				var key, val;
				for (var i in data){
					if (has.call(data, i)){
						key = serialize(i);
						val = serialize(data[i]);
						if (key && val){
							str += key + val;
						}
					}
				}
			}
			return str + ';';
	}
}
exports.encode = serialize;

// 反序列化记录
function deserialize(str){
	var len = str.length;
	var offset = 0;
	var de = function(){
		if (offset >= len){
			// out of data
			err(-6);
		}

		var val;
		var end = str.indexOf(';', offset);
		if (end == -1){
			// throw exception
			err(-1);
		}
		switch (str.charAt(offset++)){
			case 'i': // Number
				val = str.substring(offset, end);
				offset = end+1;
				return parseInt(val, 36);

			case 'f': // Float
				val = str.substring(offset, end);
				offset = end+1;
				return parseFloat(val);

			case 'I': // Int64
				val = str.substring(offset, end);
				offset = end+1;
				return Int64.fromString(val);

			case 's': // String
				end = str.indexOf(':', offset);
				if (end == -1){
					err(-2);
				}
				val = +str.substring(offset, end);
				if (isNaN(val)){
					err(-3);
				}
				offset = ++end + val;
				if (str.charAt(offset) != ';'){
					err(-4);
				}
				return str.substring(end, offset++);

			case 'a': // Array
				val = [];
				while (str.charAt(offset) != ';'){
					val.push(de());
				}
				offset++;
				return val;

			case 'o': // Object
				val = {};
				while (str.charAt(offset) != ';'){
					end = de();
					val[end] = de();
				}
				offset++;
				return val;

			case 'n': // Null
				offset++;
				return null;

			case 'N': // NaN
				offset++;
				return NaN;

			case 'B': // Buffer
				val = str.substring(offset, end);
				offset = end+1;
				return new Buffer(val, 'base64');

			case 'b': // Boolean
				val = str.charAt(offset);
				offset += 2;
				return (val === '1');

			case 'd': // Date
				val = str.substring(offset, end);
				offset = end+1;
				return new Date(parseInt(val, 36));

			case 'u':
				offset++;
				return;

			default: // Unknow
				err(-5);
		}
	}
	return de();
}
exports.decode = deserialize;


var TYPE_STRING = 1,
	TYPE_NUMBER = 2,
	TYPE_BOOLEAN = 3,
	TYPE_OBJECT = 4,
	TYPE_NULL = 5,
	TYPE_INT64 = 6,
	TYPE_BUFFER = 7,
	TYPE_DATE = 8,
	TYPE_ARRAY = 9,
	TYPE_UNDEFINED = 10,
	TYPE_NAN = 11;

// Raw Buffer Serialize Method
function rawEncodeItem(dat, bufs){
	var size, buf, val;
	switch (typeof dat){
		case 'string':
			val = new Buffer(dat);
			buf = new Buffer(1 + 4);
			buf[0] = TYPE_STRING;
			buf.writeUInt32LE(val.length, 1);
			break;

		case 'number':
			if (isNaN(dat)){
				buf = new Buffer([TYPE_NAN]);
			}else {
				buf = new Buffer(9);
				buf[0] = TYPE_NUMBER;
				buf.writeDoubleLE(dat, 1);
			}
			break;

		case 'boolean':
			buf = new Buffer([TYPE_BOOLEAN, (dat ? 1 : 0)]);
			break;

		case 'undefined':
			buf = new Buffer([TYPE_UNDEFINED]);
			break;

		case 'object':
			var str, i;
			if (dat === null)
			{
				buf = new Buffer([TYPE_NULL]);
			}
			else if (Int64.isInt64(dat))
			{
				buf = new Buffer(9);
				buf[0] = TYPE_INT64;
				buf.writeInt32LE(dat.getHighBits(), 1);
				buf.writeInt32LE(dat.getLowBits(), 5);
			}
			else if (Buffer.isBuffer(dat))
			{
				buf = new Buffer(5);
				buf[0] = TYPE_BUFFER;
				buf.writeUInt32LE(dat.length, 1);
				if (dat.length > 0){
					val = dat;
				}
			}
			else if (dat instanceof Date)
			{
				buf = new Buffer(9);
				buf[0] = TYPE_DATE;
				buf.writeDoubleLE(dat.getTime(), 1);
			}
			else if (dat instanceof Array)
			{
				var head = new Buffer(5);
				head[0] = TYPE_ARRAY;
				head.writeUInt32LE(dat.length, 1);
				bufs.push(head);
				for (var i=0; i<dat.length; i++){
					rawEncodeItem(dat[i], bufs);
				}
			}
			else
			{
				if (dat.toJSON instanceof Function)
				{
					dat = dat.toJSON();
					if ('object' != typeof dat)
					{
						rawEncodeItem(dat, bufs);
						break;
					}
				}

				var head = new Buffer(5);
				head[0] = TYPE_OBJECT;
				size = 0;
				bufs.push(head);
				for (var key in dat){
					if (has.call(dat, key)){
						rawEncodeItem(key, bufs);
						rawEncodeItem(dat[key], bufs);
						size++;
					}
				}
				head.writeUInt32LE(size, 1);
			}
			break;

		default:
			// unknow type
			err(-1);
	}
	if (buf){
		bufs.push(buf);
	}
	if (val){
		bufs.push(val);
	}
}
function rawSerialize(data){
	var bufs = [];
	rawEncodeItem(data, bufs);
	return Buffer.concat(bufs);
}
exports.rawEncode = rawSerialize;

// 反序列化记录
function rawDeserialize(buf, start){
	var len = buf.length;
	var offset = start || 0;

	var de = function(){
		if (offset >= len){
			// out of data
			err(-6);
		}

		var size, val;
		switch (buf[offset++]){
			case TYPE_STRING: // String
				size = buf.readUInt32LE(offset);
				if (size){
					offset += 4 + size;
					size = offset - size;
					return buf.slice(size, offset).toString();
				}else {
					offset += 4;
					return '';
				}

			case TYPE_BUFFER: // Buffer
				size = buf.readUInt32LE(offset);
				if (size){
					offset += 4 + size;
					size = offset - size;
					return buf.slice(size, offset);
				}else {
					offset += 4;
					return new Buffer();
				}

			case TYPE_NUMBER: // Number
				val = buf.readDoubleLE(offset);
				offset += 8;
				return val;

			case TYPE_INT64: // Int64
				size = offset;
				offset += 8;
				return new Int64(
					buf.readInt32LE(size + 4),
					buf.readInt32LE(size)
				);

			case TYPE_BOOLEAN: // Boolean
				return (buf[offset++]==1) ? true : false;

			case TYPE_OBJECT: // Object
				size = buf.readUInt32LE(offset);
				offset += 4;
				val = {};
				for (var key; size>0; size--){
					key = de();
					val[key] = de();
				}
				return val;

			case TYPE_ARRAY: // Array
				size = buf.readUInt32LE(offset);
				offset += 4;
				val = [];
				for (; size>0; size--){
					val.push(de());
				}
				return val;

			case TYPE_DATE: // Date
				val = new Date(buf.readDoubleLE(offset));
				offset += 8;
				return val;

			case TYPE_NULL: // Null
				return null;

			case TYPE_UNDEFINED: // Undefined
				return;

			case TYPE_NAN: // NaN
				return NaN;

			default: // Unknow Type
				err(-5);
		}
	}
	return de();
}
exports.rawDecode = rawDeserialize;

function err(code)
{
	var e = new Error('Serialize Data Error.');
	e.code = code;
	throw e;
}
