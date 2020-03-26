/**
 * base.js
 */

function request(url, data, callback)
{
	var method = 'GET';
	if ('function' == typeof data)
	{
		callback = data;
		data = null;
	}
	else
	{
		method = 'POST';
		data = JSON.stringify(data);
	}

	// create ajax object
	var xhr = null;
	if(window.XMLHttpRequest){
		xhr = new XMLHttpRequest();
	} else {
		xhr = new ActiveXObject('Microsoft.XMLHTTP')
	}

	// prevent cache
	if (method == 'GET')
	{
		url += (~url.indexOf('?') ? '&' : '?') + '_=' + Math.random();
		xhr.open(method, url, true);
		xhr.send();
	}
	else
	{
		xhr.open(method, url, true);
		xhr.setRequestHeader("Content-type", "application/json; charset=UTF-8");
		xhr.send(data);
	}

	// 处理返回数据
	xhr.onreadystatechange = function()
	{
		if (xhr.readyState == 4)
		{
			var result = xhr.responseText;
			if (xhr.status == 200)
			{
				result = JSON.parse(result);
			}
			else
			{
				result = {
					'succ': false,
					'code': xhr.status,
					'message': result
				};
			}

			if (result.succ)
			{
				callback(null, result.data);
			}
			else
			{
				callback(result, null);
			}
			xhr.onreadystatechange = null;
		}
	}
}

// check an object has a property
var util_has = function(obj, name){
	return Object.prototype.hasOwnProperty.call(obj, name);
}

// find dom element by id
function $(id){
	return document.getElementById(id);
}

// create dom element
function dom_create(tag, attr, parent){
	var el = document.createElement(tag);
	if (attr){
		dom_setattr(el, attr);
	}
	if (parent){
		dom_append(parent, el);
	}
	return el;
}

// set dom element attribute
function dom_setattr(el, name, attr){
	if (arguments.length > 2){
		if (name == 'style'){
			el.style.cssText = attr;
		}
		el.setAttribute(name, attr);
	}else if (typeof(name) == 'object'){
		for (var key in name){
			if (util_has(name, key)){
				dom_setattr(el, key, name[key]);
			}
		}
	}
}

// bind dom event on element
function dom_bind(el, name, callback){
	if (callback){
		if (el.attachEvent){
			el.attachEvent('on'+name, callback);
		}else {
			el.addEventListener(name, callback);
		}
	} else if (typeof(name) == 'object'){
		for (var key in name){
			if (util_has(name, key)){
				dom_bind(el, key, name[key]);
			}
		}
	}
}

// append element to another element
function dom_append(parent, child){
	parent['appendChild'](child);
}