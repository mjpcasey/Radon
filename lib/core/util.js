/**
 * Radon Core Util Module
 * -------------------------
 * Base Util Function
 */
"use strict";
var fs       = require('fs');
var sys_util = require('util');
var filepath = require('path');

function define_getter(obj, name, value){
	obj.__defineGetter__(name, function(){ return value; });
}
exports.define_const = function(map){
	var ret = {};
	for (var name in map){
		if (map.hasOwnProperty(name)){
			define_getter(ret, name, map[name]);
		}
	}
	return ret;
}

// 判断是否为NodeJS环境
// var isNode = exports.isNode = (require.resolve ? true : false);

exports.require = function(module_file){
	return require(exports.normalizePath(module_file))
}

// 格式化命令行参数
// name1:val1 name2:val2
exports.parseCommandLine = function(){
	var argv = process.argv;
	var param = {};
	var arr;
	for (var i=2; i<argv.length; i++){
		arr = argv[i].split(':');
		if (arr.length > 1 && arr[0]){
			param[arr[0]] = arr.slice(1).join(':');
		}
	}
	return param;
}
// 把参数对象转化为命令行参数格式
exports.formatCommandLine = function(script, param){
	var argv = [];
	if (typeof(script) == 'string'){
		argv.push(script);
	}else {
		param = script;
	}
	for (var name in param){
		if (param.hasOwnProperty(name)){
			argv.push(name + ':' + param[name]);
		}
	}
	return argv;
}

// 路径格式化
var path_app_root = '';
var path_radon_root = __dirname + '/../..';
exports.initPath = function(app_root){
	path_app_root = app_root;
}

// 转换规格化目录地址
exports.normalizePath = function(path){
	if (path){
		if (path.charAt(0) == '/'){
			path = path_app_root + path;
		// }else if (path.substr(0,3) == '../'){
		// 	path = path_app_root + '/' + path;
		// UPDATE: use /../path/to instead
		}else if (path.substr(0,7) == '@radon/'){
			path = path_radon_root + path.slice(6);
		// }else {
		// 	UPDATE: support relative path string
		// 	path = path_radon_root + '/' + path;
		}
		return filepath.normalize(path);
	}else {
		return path;
	}
}

/**
 * 解析网络地址字符串
 * 
 * @param {Number|String} addr -地址
 * @param {Boolean} unlink -是否删除
 */
exports.formatNetAddress = function(addr, unlink)
{
	// check is a port number
	if ('number' == typeof addr)
	{
		return [addr];
	}

	// unix:/path/to/socket
	if (addr.indexOf('unix:') === 0)
	{
		addr = exports.normalizePath(addr.slice(5));
		if (unlink)
		{
			try {
				if (fs.statSync(addr).isSocket())
				{
					fs.unlinkSync(addr);
				}
			}
			catch (err)
			{}
		}
		return [addr];
	}

	// tcp:host:port
	addr = addr.split(':');
	if (addr[0] == 'tcp')
	{
		addr.shift();
	}
	var port = parseInt(addr.pop());
	if (isNaN(port))
	{
		return false;
	}
	return (addr.length > 0) ? [port, addr.join(':')] : [port];
}

// 配置文件信息加载读取
var config_cache = new Map();
exports.config = function(file, property){
	if (!file){
		return null;
	}
	var config = config_cache.get(file);
	if (!config){
		// 配置缓存有效期 10 分钟
		config = {
			'data': loadConfig(file),
			'time': Date.now()
		};
		config_cache.set(file, config);
	}

	// 加载配置文件数据正确, 开始分析要获取的配置
	var data = config.data;
	if (data){
		data = exports.getProp(data, property);
	}
	return data;
}
exports.reload_config = function()
{
	config_cache.clear();
}
exports.get_config_cache_stat = function()
{
	var result = [];
	for (var pair of config_cache)
	{
		result.push({
			'file': pair[0],
			'time': pair[1].time
		});
	}
	return result;
}

exports.getProp = function(data, property) {
	if(!sys_util.isString(property) || !data) {
		return data;
	}

	var ret = data;

	var ns = property ? property.split('.') : false;
	while (ns && ns.length>0){
		if (ret && ret.hasOwnProperty(ns[0])){
			ret = ret[ns.shift()];
		}else {
			ret = null;
			break;
		}
	}

	return ret;
};

// 加载配置文件, 文件必须设定变量 config 用作返回对象
function loadConfig(file){
	file = exports.normalizePath(file);
	var exists = fs.existsSync(file);
	if (exists){
		try {
			var data = fs.readFileSync(file, {encoding: 'utf8'});
			data = (new Function(
				'util','require','__filename',
				data + ';return config;'
			))(exports, require, file);
			if (data){
				return data;
			}
		}catch (e){
			exports.log(44, "loadConfig Error:\n%s", e.stack);
			exports.logError(100, '加载配置文件错误, 配置文件格式不符合要求'+file);
		}
	}else {
		exports.logError(101, '指定的配置文件不存在'+file);
	}
	return false;
}

/**
调试等级

0 - debug 调试
1 - log 日志
2 - notice 提醒
3 - warn 警告
4 - error 错误

0 - 系统运行 (进程)
10- 框架通讯
20- 框架核心模块
30- 框架外部模块
40- 配置信息
50- 用户模块异常
100+ 用户自定义
**/
var debug_mode = false;
var _min_debug_range = 0;
var _max_debug_range = 0;
var _debug_show_type = 0;
var _debug_skips = 0;
exports.set_debug = function(mode, skips)
{
	if ('number' == typeof mode && Number.isFinite(mode))
	{
		debug_mode = mode;
		mode = Math.abs(mode);
		_debug_show_type = mode % 5;

		var is_range = (mode % 10) > 4;
		if (debug_mode < 0)
		{
			if (is_range)
			{
				_max_debug_range = mode + 10 - (mode % 10);
				_min_debug_range = 0;
			}
			else
			{
				_max_debug_range = mode + 1;
				_min_debug_range = mode;
			}
		}
		else
		{
			_min_debug_range = mode - (mode % 10);
			_max_debug_range = is_range ? Infinity : _min_debug_range + 10;
		}
	}
	else
	{
		debug_mode = Boolean(mode);
	}
	// skip specified error level
	_debug_skips = skips;
}

/*是否为debug模式 */
exports.get_debug = function()
{
	return debug_mode;
}

// 统计记录错误信息
var error_logs = [];
function get_error_logs(){
	return error_logs;
}
// 记录错误信息
exports.logError = function(code, message, data){
	var logs = get_error_logs();
	logs.unshift({'error': code, 'message': message, 'data': (data || null)});
	exports.log(24, 'ERROR[%d] - %s', code, message, (data===undefined?'':data));
	return code;
}
// 获取记录的错误信息
exports.getError = function(count){
	var logs = get_error_logs();
	if (count === undefined){
		count = logs.length;
		return logs.splice(0, count);
	}else if (count === 1){
		return logs.shift();
	}else {
		return logs.splice(0, count);
	}
}
// 日志记录, 根据 level 等级与 debug_mode 决定是否打印信息
var _colors = [
	['\x1B[90m', '\x1B[39m'], // debug (grey)
	['\x1B[32m', '\x1B[39m'], // log (green)
	['\x1B[36m', '\x1B[39m'], // notice (cyan)
	['\x1B[33m', '\x1B[39m'], // warn (yellow)
	['\x1B[41m', '\x1B[49m']  // error (red background)
];
var _LOG_CALLBACK = function(level, args)
{
	var fn = (level % 5) == 4 ? console.error : console.log;
	fn.apply(console, args);
}
exports.setLogCallback = function(cb)
{
	_LOG_CALLBACK = cb;
}
exports.log = function(level, message){
	if (_debug_skips && ~_debug_skips.indexOf(level))
	{
		return;
	}
	var debug = debug_mode;
	if (debug !== true && debug !== false)
	{
		debug = (level >= _min_debug_range) &&
			(level < _max_debug_range) &&
			((level % 5) >= _debug_show_type);
	}
	if (debug){
		var c = _colors[level % 5];
		var code = ('___'+level).substr(-4);
		message = c[0] + (new Date()).toLocaleString() +
			' E%s ' + message + c[1];

		var args = arguments;
		if (args.length > 2){
			args = Array.prototype.slice.call(args);
			args[0] = message;
			args[1] = code;
		}else {
			args = [message, code];
		}
		_LOG_CALLBACK(level, args);
	}
}


exports.exit = function(code, message){
	if (message){
		console.log(message);
	}
	process.exit(code);
}

var objectHas = Object.prototype.hasOwnProperty;

// // Clone Object
// var cloneKey = '___deep_clone___';
// exports.clone = function(value){
// 	switch (true){
// 		case (value instanceof Date):
// 			return new Date(value.getTime());
// 		case (value instanceof Object):
// 		// case (value instanceof Array):
// 			// 已经被克隆过, 返回新克隆对象
// 			if (value[cloneKey]){
// 				return value[cloneKey];
// 			}

// 			var objClone = value[cloneKey] = (Array.isArray(value) ? [] : {});
// 			for (var key in value){
// 				if (key !== cloneKey && objectHas.call(value, key)){
// 					objClone[key] = exports.clone(value[key]);
// 				}
// 			}
// 			delete value[cloneKey];
// 			return objClone;
// 	}
// 	return value;
// }


function ObjectKey(obj, value, field){
	if (obj){
		var alen = (arguments.length > 2);
		var val;
		for (var key in obj){
			if (objectHas.call(obj, key)){
				val = alen ? obj[key][field] : obj[key];
				if ((val === value) || (value && value == val)){
					return key;
				}
			}
		}
	}
	return null;
}

// 查找特定记录的索引值
exports.index = ObjectKey;

// 查找记录中的特定记录
exports.find = function(list){
	var key = ObjectKey.apply(this, arguments);
	if (key === null){
		return null;
	}else {
		return list[key];
	}
}

exports.toArray = function(argv){
	return Array.prototype.slice.call(argv);
}


// 生成 token 函数
exports.token = function(size, code){
	var chars = code || 'ABCDEFGHIJKLNMOPQRSTUVWXYZabcdefghijklnmopqrstuvwxyz0123456789!*()';
	var token = '';
	var len = chars.length;
	while (size-- > 0){
		token += chars.charAt(parseInt(Math.random() * len));
	}
	return token;
};

exports.ticket = function(size){
	return exports.token(size,'0123456789qpwoeirutyhgjfkdlsabvncmxzQAZXSWEDCVFRTGBNHYUJMKIOPL*!');
};

function filterDuplicate(arr){
	arr = arr.filter(function(value,pos,self){
		return self.indexOf(value) == pos;
	});
	return arr;
}
exports.filterDuplicate = filterDuplicate;

function crc32(buffer) {
  var table =
    '00000000 77073096 EE0E612C 990951BA 076DC419 706AF48F E963A535 9E6495A3 0EDB8832 79DCB8A4 E0D5E91E 97D2D988 09B64C2B 7EB17CBD E7B82D07 90BF1D91 1DB71064 6AB020F2 F3B97148 84BE41DE 1ADAD47D 6DDDE4EB F4D4B551 83D385C7 136C9856 646BA8C0 FD62F97A 8A65C9EC 14015C4F 63066CD9 FA0F3D63 8D080DF5 3B6E20C8 4C69105E D56041E4 A2677172 3C03E4D1 4B04D447 D20D85FD A50AB56B 35B5A8FA 42B2986C DBBBC9D6 ACBCF940 32D86CE3 45DF5C75 DCD60DCF ABD13D59 26D930AC 51DE003A C8D75180 BFD06116 21B4F4B5 56B3C423 CFBA9599 B8BDA50F 2802B89E 5F058808 C60CD9B2 B10BE924 2F6F7C87 58684C11 C1611DAB B6662D3D 76DC4190 01DB7106 98D220BC EFD5102A 71B18589 06B6B51F 9FBFE4A5 E8B8D433 7807C9A2 0F00F934 9609A88E E10E9818 7F6A0DBB 086D3D2D 91646C97 E6635C01 6B6B51F4 1C6C6162 856530D8 F262004E 6C0695ED 1B01A57B 8208F4C1 F50FC457 65B0D9C6 12B7E950 8BBEB8EA FCB9887C 62DD1DDF 15DA2D49 8CD37CF3 FBD44C65 4DB26158 3AB551CE A3BC0074 D4BB30E2 4ADFA541 3DD895D7 A4D1C46D D3D6F4FB 4369E96A 346ED9FC AD678846 DA60B8D0 44042D73 33031DE5 AA0A4C5F DD0D7CC9 5005713C 270241AA BE0B1010 C90C2086 5768B525 206F85B3 B966D409 CE61E49F 5EDEF90E 29D9C998 B0D09822 C7D7A8B4 59B33D17 2EB40D81 B7BD5C3B C0BA6CAD EDB88320 9ABFB3B6 03B6E20C 74B1D29A EAD54739 9DD277AF 04DB2615 73DC1683 E3630B12 94643B84 0D6D6A3E 7A6A5AA8 E40ECF0B 9309FF9D 0A00AE27 7D079EB1 F00F9344 8708A3D2 1E01F268 6906C2FE F762575D 806567CB 196C3671 6E6B06E7 FED41B76 89D32BE0 10DA7A5A 67DD4ACC F9B9DF6F 8EBEEFF9 17B7BE43 60B08ED5 D6D6A3E8 A1D1937E 38D8C2C4 4FDFF252 D1BB67F1 A6BC5767 3FB506DD 48B2364B D80D2BDA AF0A1B4C 36034AF6 41047A60 DF60EFC3 A867DF55 316E8EEF 4669BE79 CB61B38C BC66831A 256FD2A0 5268E236 CC0C7795 BB0B4703 220216B9 5505262F C5BA3BBE B2BD0B28 2BB45A92 5CB36A04 C2D7FFA7 B5D0CF31 2CD99E8B 5BDEAE1D 9B64C2B0 EC63F226 756AA39C 026D930A 9C0906A9 EB0E363F 72076785 05005713 95BF4A82 E2B87A14 7BB12BAE 0CB61B38 92D28E9B E5D5BE0D 7CDCEFB7 0BDBDF21 86D3D2D4 F1D4E242 68DDB3F8 1FDA836E 81BE16CD F6B9265B 6FB077E1 18B74777 88085AE6 FF0F6A70 66063BCA 11010B5C 8F659EFF F862AE69 616BFFD3 166CCF45 A00AE278 D70DD2EE 4E048354 3903B3C2 A7672661 D06016F7 4969474D 3E6E77DB AED16A4A D9D65ADC 40DF0B66 37D83BF0 A9BCAE53 DEBB9EC5 47B2CF7F 30B5FFE9 BDBDF21C CABAC28A 53B39330 24B4A3A6 BAD03605 CDD70693 54DE5729 23D967BF B3667A2E C4614AB8 5D681B02 2A6F2B94 B40BBE37 C30C8EA1 5A05DF1B 2D02EF8D';

  var crc = 0;
  var x = 0;
  var y = 0;

  crc = crc ^ (-1);
  for (var i = 0, iTop = buffer.length; i < iTop; i++) {
    y = (crc ^ buffer.readUInt8(i)) & 0xFF;
    x = '0x' + table.substr(y * 9, 8);
    crc = (crc >>> 8) ^ x;
  }
  return crc ^ (-1);
}
exports.crc32 = crc32;

var cryto = require('crypto');
exports.md5 = function(str, key) {
	if(!(str instanceof Buffer)) {
		str = new Buffer(str);
	}

	var enc;
	if (arguments.length > 1)
	{
		enc = cryto.createHmac('md5', key);
	}
	else
	{
		enc = cryto.createHash('md5');
	}

	enc.update(str);

	return enc.digest('hex');
};

exports.md5Buffer = function(str, key) {
	var enc;
	if (arguments.length > 1)
	{
		enc = cryto.createHmac('md5', key);
	}
	else
	{
		enc = cryto.createHash('md5');
	}
	enc.update(str);
	return enc.digest();
};

var index_regx = /(?:{(\d+)}|%(\d+))/g;
var index_args = null;
function replace_index(m, n1, n2){
	if (n2){
		n1 = n2;
	}
	return (index_args.hasOwnProperty(n1) ? index_args[n1] : m);
}


var LANG_DATA = new Map();
var LANG_CONFIG;
var RADON_GET_CONTEXT;
exports.LANG = function(str) {
	if (!RADON_GET_CONTEXT)
	{
		let radon = require('../radon');
		RADON_GET_CONTEXT = radon.getContextData;
		LANG_CONFIG = radon.config('path.lang')
	}

	var lang = RADON_GET_CONTEXT('lang');
	if (LANG_CONFIG && lang && lang !== LANG_CONFIG.def)
	{
		let translate;
		if (LANG_DATA.has(lang))
		{
			translate = LANG_DATA.get(lang);
		}
		else
		{
			try {
				translate = require(LANG_CONFIG.root + lang + '/translate.json');
				translate = translate && translate.result;
			}
			catch(e) {}

			LANG_DATA.set(lang, translate);

			if (translate)
			{
				var path = translate._path_;
				var func = translate._func_;
				if (path && func && LANG_CONFIG.path_func[lang])
				{
					try {
						var m = exports.require(LANG_CONFIG.path_func[lang]);
					}
					catch(e) {}
					if (m && m[func])
					{
						translate.func = m[func];
					}
				}
			}
		}

		if (translate)
		{
			if (translate.hasOwnProperty(str))
			{
				str = translate[str];
			}
			else if (translate.func)
			{
				str = unescape(str.replace(/\\u/g, '%u'));
				str = translate.func(str);
			}
		}
	}

	index_args = arguments;
	return str.replace(index_regx, replace_index);
};

// 数据提取和格式化
function splitIds(str, spliter, mode){
	if (typeof str == 'string'){
		str = str.split(spliter);
	}
	var ids = [];
	if (str instanceof Array){
		for (var id,i=str.length; i>0;){
			id = +str[i];
			if ((mode && id) || (!mode && !isNaN(id))){
				ids.push(id);
			}
		}
	}
	return ids;
}

var formats = {
	'int': function(d){ return parseInt(d,10) || 0; },
	'float': function(d){ return +d || 0; },
	'bool': function(d){
		switch (d){
			case 'false':
			case '0':
			case 'null':
				return false;
			default:
				return !!d;
		}
	},
	'trim': function(d){ return String(d).trim(); },
	'commaIds': function(d){ return splitIds(d, ',', 1); },
	'semiIds': function(d){ return splitIds(d, ';', 1); }
};
exports.format = formats;

exports.getValue = function(data, property, def, format){
	if(arguments.length === 1) {
		return data;
	}
	if (typeof data == 'object' && data.hasOwnProperty(property)){
		data = data[property];
		if (format){
			if (typeof format == 'function'){
				return format(data);
			}else if (formats[format]){
				return formats[format](data);
			}
		}
		return data;
	}else {
		return def;
	}
}

exports.isEmpty = function(data){
	if (typeof data == 'object'){
		for (var i in data){
			return false;
		}
		return true;
	}else {
		return !data;
	}
}

// checking function is a generator
try {
	var _generatorConstructor =
		(new Function('return (function*(){}).constructor'))();
	exports.isGenerator = function(fn)
	{
		return (fn instanceof _generatorConstructor);
	}

	var _generatorInstanceConstructor =
		(new Function('return (function*(){})().constructor'))();
	exports.isGeneratorInstance = function(gen)
	{
		return (gen.constructor === _generatorInstanceConstructor);
	}
}
catch (e)
{
	exports.isGenerator = function(fn)
	{
		return false;
	}
	exports.isGeneratorInstance = function(fn)
	{
		return false;
	}
}

/**
 * 格式化数字, 自动补0前续
 * @param  {Number} number 要格式化的数字
 * @param  {Number} size   格式化后出来的数字位数
 * @return {String}        格式化结果
 */
function fix0(number, size){
	number = number.toString();
	while (number.length < size){
		number = '0' + number;
	}
	return number;
}
exports.fix0 = fix0;

/**
 * 转换对象为JS Date对象
 * @param  {Mix}    date   <可选> 日期数据(时间戳, 字符串, Date对象, 空)
 * @param  {Number} offset 修正偏移的秒数
 * @return {Date}          返回JS Date对象 / NULL 日期格式错误
 */
var date_regx = /[^\d]+/;
function toDate(date, offset){
	var ts;
	if (date instanceof Date){
		ts = date;
	}else if (isNaN(+date)){
		if (typeof date == 'string'){
			date = date.split(date_regx);
			if (date.length === 3){
				ts = new Date(+date[0], date[1]-1, +date[2], 0, 0, 0, 0);
				if (isNaN(+ts)){
					ts = null;
				}
			}
		}else {
			return null;
		}
	}
	if (!ts){
		if (!date){ return null; }
		ts = new Date();
		if (date > 5e8){
			// 时间戳
			ts.setTime(date * 1000);
		}else{
			// 时间偏移(秒数)
			ts.setTime(ts.getTime() + date * 1000);
		}
	}
	if (!isNaN(+offset)){
		ts.setTime(ts.getTime() + offset * 1000);
	}
	return ts;
}
exports.toDate = toDate;

/**
 * 转换时间戳到格式化时间字符串
 */
var timestamp = null;
var format_exp = /[YymndjNwaAghGHisT]/g;
function format_callback(tag){
	var t = timestamp;
	switch (tag){
		case 'Y': return t.getFullYear();
		case 'y': return t.getFullYear() % 100;
		case 'm': return fix0(t.getMonth()+1, 2);
		case 'n': return t.getMonth()+1;
		case 'd': return fix0(t.getDate(), 2);
		case 'j': return t.getDate();
		case 'N': return t.getDay();
		case 'w': return t.getDay() % 7;
		case 'a': return t.getHours() < 12 ? 'am':'pm';
		case 'A': return t.getHours() < 12 ? 'AM':'PM';
		case 'g': return t.getHours() % 12 + 1;
		case 'h': return fix0(t.getHours() % 12 + 1, 2);
		case 'G': return t.getHours();
		case 'H': return fix0(t.getHours(), 2);
		case 'i': return fix0(t.getMinutes(), 2);
		case 's': return fix0(t.getSeconds(), 2);
		case 'T': return Math.round(t.getTime()/1000);
	}
	return tag;
}
exports.date = function(format, date, offset){
	if (!format) {return '';}
	timestamp = toDate(date, offset);
	if (timestamp === null){ timestamp = new Date(); }
	return format.replace(format_exp, format_callback);
}

exports.values = function(data){
	var vals = [];
	if (data){
		for (var i in data){
			vals.push(data[i]);
		}
	}
	return vals;
}

exports.mkdir = function(path, mode) {
	var error = require('./error.js');
	if (!mode){
		mode = 511; /*0777*/
	}

	var last, stat, queue = [];
	while (path != last){
		try {
			stat = fs.stat(path);
			if (stat.isDirectory()){
				break;
			}else {
				error.throw(1000, [path]);
			}
		}catch(e){
			queue.push(path);
			last = path;
			path = filepath.dirname(last);
		}
	}
	try {
		while (path = queue.pop()){
			fs.mkdir(path, mode);
		}
	}catch(e){
		error.throw(1001, [path, e.message]);
	}

	return true;
};


var tagMaps = null;
var tagRegx = /\{\$([\d\w_]+)\}/g;
function tagReplaceCallback(all, tag){
	return tagMaps.hasOwnProperty(tag) ? tagMaps[tag] : all;
}
exports.replaceTag = function(string, tags){
	if (string) {
		tagMaps = tags;
		string = string.replace(tagRegx, tagReplaceCallback);
		tagMaps = null;
	}
	return string;
};

exports.isPlainObject = function(obj) {
	if (obj && Object.prototype.toString.call(obj).slice(8,-1) == 'Object') {
		return true;
	}
	return false;
};

var _currentContext = null;
exports.getContext = function()
{
	return _currentContext;
}

exports.setContext = function(context)
{
	var ct = _currentContext;
	_currentContext = context;
	return ct;
}

var _radonPromise = require('./promise');
exports.setPromiseClass = function(promise)
{
	_radonPromise = promise;
}

exports.getPromiseClass = function()
{
	return _radonPromise;
}

exports.promiseResolve = function(data)
{
	return _radonPromise.resolve(data);
}

exports.promiseReject = function(data)
{
	return _radonPromise.reject(data);
}

exports.promiseAll = function(promises)
{
	return _radonPromise.all(promises);
}

exports.promise = function(fn)
{
	return new _radonPromise(fn);
}

var CLOCK = 30; // 一个时钟
// warp generator to promise
function generatorIteration(state, value)
{
	var result;
	var stack = this.pop();
	var last_ctx = exports.setContext(stack[1]);
	while (1)
	{
		try {
			if(value)
			{
				// generator instance
				// push stack, go into the new generator loop
				if (exports.isGeneratorInstance(value))
				{
					stack[1] = exports.getContext();
					stack[2] = Date.now();
					this.push(stack);
					stack = [value, stack[1], stack[2]];
				}
				// promise object
				// wait async callback
				else if (value.then instanceof Function)
				{
					stack[1] = exports.setContext(last_ctx);
					stack[2] = Date.now();
					this.push(stack);
					value.then(this[2], this[3]);
					return;
				}
			}

			if (state)
			{
				result = stack[0].throw(value);
			}
			else
			{
				result = stack[0].next(value);
			}

			// update the next function state
			state = 0;
			value = result.value;

			if (result.done)
			{
				// here for the generator because the generator would set the context,so the argu would more than 4 at least--rirong
				if (this.length > 4)
				{
					// exit generator loop, back to the last stack
					stack = this.pop();
					stack[2] = Date.now();
					exports.setContext(stack[1]);
				}
				else
				{
					// all process done
					break;
				}
			}
			else
			{
				if(Date.now() - stack[2] > CLOCK)
				{
					// after the a clock, check the abort Queue
					var request = stack[1] && stack[1].get('request');
					if(request)
					{
						let header = request.getHeader();
						if(header)
						{
							let prop = `${header.link_id}_${header.ref}`;
							if(global && global._Abort && global._Abort.has(prop))
							{
								global._Abort.delete(prop);
								value = {message: `Aborted By InterFace, mid: ${header.ref}`};
								exports.log(20, value.message);
								state = 1;
							}
						}
					}

					// clock over, wait for the next clock, to rest
					let v = value;
					value = new Promise(function(ok, fail) {
						setTimeout(function() {
							if(state)
							{
								fail(v);
							}
							else
							{
								ok(v);
							}
						}, 0);
					});
				}
			}
		}
		catch (error)
		{
			state = 1;
			value = error;

			if (this.length > 4)
			{
				// exception break
				// pop the stack and trigger the exception throw
				stack = this.pop();
				exports.setContext(stack[1]);
			}
			else
			{
				// log request message
				let req = stack && stack[1] && stack[1].get('request');
				if(req)
				{
					let h = req.getHeader();
					if(h)
					{
						exports.log(104, `The Error Request, Source: ${h.source_process}:${h.source_module};Target: ${h.process}:${h.module}`)
					}
				}
				// all process done, trigger the global exception
				break;
			}
		}
	}

	exports.setContext(last_ctx);
	this[state](value)
}

function Sync(){}
Sync.prototype._call = function(mode, data) {
	if (mode)
	{
		this._mode = mode;
		this._data = data;
	}
	switch (this._mode)
	{
		case 1:
			if (this._ok)
			{
				this._ok(this._data);
			}
			break;
		case 2:
			if (this._fail)
			{
				this._fail(this._data);
			}
			break;
	}
};
Sync.prototype.reset = function() {
	this._mode = this._ok = this._fail = 0;
};
Sync.prototype.then = function(ok, fail) {
	this._ok = ok;
	this._fail = fail;
	this._call(0);
};
Sync.prototype.cb = function() {
	return (err, data) => {
		err ? this._call(2, err) : this._call(1, data);
	}
};
Sync.prototype.succ = function() {
	return data => this._call(1, data);
};
Sync.prototype.err = function() {
	return err => this._call(2, err);
};

exports.gSync = function(){
	return new Sync();
}
exports.generator = function(gen_fn)
{
	if (!exports.isGenerator(gen_fn))
	{
		return gen_fn;
	}

	return function()
	{
		var generator = gen_fn.apply(this, arguments);
		var ctx = exports.getContext();
		return exports.promise(
			function(done, fail)
			{
				var context = [done, fail, 0, 0, [generator, ctx, Date.now()]];
				context[2] = generatorIteration.bind(context, 0);
				context[3] = generatorIteration.bind(context, 1);
				context[2]();
			}
		);
	}
}
exports.toPromise = function(generator)
{
	if (exports.isGeneratorInstance(generator))
	{
		var ctx = exports.getContext();
		return exports.promise(
			function(done, fail)
			{
				var context = [done, fail, 0, 0, [generator, ctx, Date.now()]];
				context[2] = generatorIteration.bind(context, 0);
				context[3] = generatorIteration.bind(context, 1);
				context[2]();
			}
		);
	}
	else
	{
		return exports.promiseResolve(generator);
	}
}
exports.toSync = function(ctx, fn)
{
	var args = Array.prototype.slice.call(arguments, 2);
	if (ctx instanceof Function)
	{
		args.unshift(fn);
		fn = ctx;
	}
	var gs = new Sync();
	args.push(gs.cb());

	fn.apply(ctx, args);
	return gs;
}

exports.FILE_MAP =
{
	'png': 'image/png',
	'gif': 'image/gif',
	'jpg': 'image/jpeg',
	'jpeg': 'image/jpeg',
	'json': 'application/json',
	'js': 'application/x-javascript; charset=utf-8',
	'css': 'text/css',
	'html': 'text/html; charset=utf-8',
	'htm': 'text/html; charset=utf-8',
	'ico': 'image/x-icon',
	'swf':'application/x-shockwave-flash',
	'flv':'video/x-flv',
	'mp4':'video/mp4',
	'svg':'image/svg+xml',
};

var _specialchars_replacer = {
	'&': '&amp;',
	'/': '&3x2F',
	'<': '&lt;',
	'>': '&gt;',
	'"': "&quot;",
	"'": '&#x27;'
}
// 转义字符串中的html特殊字符
function htmlspecialchars (str, skipChars) {
	if (typeof str === 'string') {
		var ret = '';
		for (var i = 0; i < str.length; i++) {
			let _char = str.charAt(i);
			if ((_char in _specialchars_replacer) && (!skipChars || skipChars.indexOf(_char) === -1)) {
				ret += _specialchars_replacer[_char];
			} else {
				ret += _char;
			}
		}

		return ret;
	}

	return str;
}
exports.htmlspecialchars = htmlspecialchars;


/* xss检查配置示例：
	{
		// 开启xss检查
		xss_check_open: true,
		// 白名单配置
		xss_check_whitelist: {
			// method白名单，可选值 get: 跳过url参数, post: 跳过body内容，websocket：跳过websocket
			methods: ['post']
			// 接口白名单
			// uri里的大写前缀已经处理，可以不用带HTTP_API/等前缀
			uri: {
				// 跳过指定接口，值必须为*
				'sweety/add': '*',
				// 跳过指定路径开始的接口
				'sweety/*': '*',
				// 跳过指定接口的指定字段， 数组的每一项都为不需要检查的字段
				'sweety/edit': ['name', 'background.text', 'elements[]', 'sizes[].name']
			}
		}
	}
*/
var XSS_CHECK_WHITELIST;
var XSS_CHECK_OPEN = false;

/**
 * 接口输入信息xss敏感字符检查
 * @param  {Mix}    data   数据内容
 * @param  {String} uri    接口uri
 * @param  {String} method 方法类型          
 * @return {Mix}    返回过滤后的data
 */
exports.xssCheck = function(data, uri, method) {
	if (!XSS_CHECK_WHITELIST) {
		let radon = require('../radon');
		XSS_CHECK_WHITELIST = radon.config('xss_check_whitelist');
		XSS_CHECK_OPEN = radon.config('xss_check_open');
	}
	
	if (!XSS_CHECK_OPEN) {
		return data;
	}
	
	var config = XSS_CHECK_WHITELIST || {};
	var skip_methods = config.methods || [];
	
	// method在白名单
	if (method && skip_methods.indexOf(method.toLowerCase()) > -1) {
		return data;
	}
	
	var config_uri = config.uri || {};
	var whitelist = config_uri[uri];
	
	var uri_no_prefix;
	if (!whitelist) {
		uri_no_prefix = uri.replace(/^[A-Z_]+\//, '');
		whitelist = config_uri[uri_no_prefix];
	}

	// 模糊匹配
	if (!whitelist) {
		for (let config_key in config_uri) {
			if (!config_uri.hasOwnProperty(config_key)) {
				continue;
			}
			if (config_key.charAt(config_key.length - 1) !== '*') {
				continue;
			}

			let start_chars = config_key.substr(0, config_key.length - 1);
			if (uri.indexOf(start_chars) === 0 || uri_no_prefix.indexOf(start_chars) === 0) {
				whitelist = config_uri[config_key];
				break;
			}
		}
	}

	// whitelist为*时
	if (whitelist === '*') {
		return data;
	}

	return _xssCheckRecursive(data, uri, whitelist);
}
/**
 * 递归数据对象，检查值为字符串的value是否包含敏感字符
 * 
 * @param {Object|Array|String} data -待检查的数据
 * @param {String} uri -uri
 * @param {whitelist} whitelist -白名单 不检查的字段路径配置
 * @param {String} field_path -字段路径
 */
function _xssCheckRecursive(data, uri, whitelist, field_path) {
	field_path = field_path || '';

	if (Array.isArray(data)) {
		return data.map(function(value) {
			return _xssCheckRecursive(value, uri, whitelist, field_path + '[]');
		});
	} else if (exports.isPlainObject(data)) {
		Object.keys(data).forEach(function(key) {
			data[key] = _xssCheckRecursive(data[key], uri, whitelist, field_path ? field_path + '.' + key : key);
		});
		return data;
	} else if (typeof data === 'string' && (!whitelist || whitelist.indexOf(field_path) === -1)) {
		if (isStrHasXssChars(data)) {
			var error = require('./error.js');
			error.throw(5001, [field_path]);
		}
	}
	
	return data;
}

// xss敏感字符集合
var _xss_check_chars_list = [
	'&amp;',
	'&3x2F',
	'&lt;',
	'&gt;',
	"&quot;",
	'&#x27;',
	'javascript:',
	/<\/?.*?>/,
	/['"]\s*on\S+/,
	/['"]\s*href=\S+/,
	/['"]\s*src=\S+/
];
// 检查字符串是否包含xss敏感字符
function isStrHasXssChars(str) {
	if (typeof str === 'string') {
		var lower_str = str.toLowerCase();
		for (let _chars of _xss_check_chars_list) {
			if (typeof _chars === 'string' && lower_str.indexOf(_chars) > -1 || _chars instanceof RegExp && _chars.test(lower_str)) {
				return true;
			}
		}
	}
}
exports.isStrHasXssChars = isStrHasXssChars;
// 设置xss敏感字符
exports.addXssCheckChars = function(unsafe_chars, replace) {
	_xss_check_chars_list = replace ? [].concat(unsafe_chars) : _xss_check_chars_list.concat(unsafe_chars);
}