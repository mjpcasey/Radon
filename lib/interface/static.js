/**
 * @file Radon Static Web File Interface
 */

"use strict";
var util = require('../core/util.js');
var base = require('../core/base.js');
var http = require('http');
var fs = require('fs');

var TYPES = util.FILE_MAP;

module.exports = base.Class.extend({
	init: function(config, ipc, last)
	{
		var self = this;

		// 保存基础路径
		self._root = util.normalizePath(config.root);
		//指定映射的路径
		self._alias = config.alias || [];

		self._listen = config.listen;

		if (last)
		{
			if (last._listen == self._listen)
			{
				// use last server instance
				self._server = last._server;
				self._server.removeAllListeners();
			}
			else
			{
				// port change, free last server
				last.free();
			}
		}

		if (!self._server)
		{
			// no server, create new one
			self._server = http.createServer();
			self._server.listen.apply(
				self._server,
				util.formatNetAddress(self._listen, true)
			);
		}

		// bind the server event;
		self._server.on(
			'error',
			function(err)
			{
				util.log(24, 'Static HTTP Server error:', err);
			}
		)
		.on(
			'request',
			self.onRequest.bind(self)
		);

		util.log(21, 'Static HTTP Server listen on %s', self._listen);
	},
	// 释放之前启的服务
	free: function()
	{
		this._server.close();
	},
	/* server requst */
	onRequest: function(req, res)
	{
		var self = this;
		var url = req.url.split('?', 1).shift();
		if (url.slice(-1) == '/'){
			url += 'index.html';
		}

		var aliasFlag ,path;
		//判断是否在配置的 alias
		if (self._alias.length > 0)
		{
			for(let alias of self._alias)
			{
				if (url.indexOf(alias['url']) === 0)
				{
					path = util.normalizePath(alias['root']) + url;
					aliasFlag = true;
					break;
				}
			}
		}

		if(!aliasFlag){
			//alias配置没处理
			path = self._root + url;
		}

		if (fs.existsSync(path) && fs.statSync(path).isFile()){
			// 输出存在的目录文件
			var ext = path.split('.');
			ext = ext.length > 1 ? ext.pop().toLowerCase() : '';
			if (ext && TYPES[ext]){
				res.setHeader('content-type', TYPES[ext]);
			}
			var stream = fs.createReadStream(path);
			stream.pipe(res);
		}else {
			// 404文件没找到哦
			res.writeHead(404, 'FILE NOT FOUND');
			res.end('FILE_WAS_GONE');
		}
	}
});