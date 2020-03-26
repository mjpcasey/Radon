/**
 * @file Radon Reverse Proxy Interface
 */

"use strict";

var net = require('net');
var http = require('http');
var util = require('../core/util.js');
var base = require('../core/base.js');

var header_max  = 64000;
var http_regx   = /^(GET|POST|PUT|DELETE) (\/[^ ]*) HTTP\/1\.[01]$/m;
var conn_regx   = /^Connection:\s+Upgrade$/im;
var length_regx = /^Content-Length: (.+)$/im;

module.exports = base.Class.extend({
	init: function(config, ipc, last){
		var self = this;
		// 保存远端节点地址
		self._remotes = config.remotes;
		self._listen = config.listen;
		self._request_timeout = (config.request_timeout || 120) * 1000;

		// transfrom the remote config
		var item;
		for (var i = 0; i < self._remotes.length; i++)
		{
			item = self._remotes[i];
			item._opts = item.remote ? util.formatNetAddress(item.remote) : false;
		}

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
				// listen change, free last server
				last.free();
			}
		}

		if (!self._server)
		{
			// no server, create new one
			self._server =  http.createServer();
			self._server.setTimeout(self._request_timeout);
			let mask = config.mask;
			let old_mask;
			if(mask)
			{
				old_mask = process.umask(~mask & 0o777);
			}

			self._server.listen.apply(
				self._server,
				util.formatNetAddress(self._listen, true)
			);

			if(mask)
			{
				process.umask(old_mask);
			}
		}

		// bind the server event;
		self._server.on('error', (err) => {
			util.log(24, 'Proxy Server error:', err);
		})
		.on('request', self.onRequest.bind(self))
		.on('upgrade', self.onUpgrade.bind(self));

		util.log(21, 'Proxy Server listen on %s', self._listen);
	},
	/* HTTP请求代理转发 */
	onRequest: function(req, res)
	{
		var remote = this.getRemote(req);
		if (remote)
		{
			var rs = http.request(remote, (rss) => {
				res.writeHead(rss.statusCode, rss.headers);
				rss.pipe(res);
			});

			rs.setTimeout(this._request_timeout);
			rs.on('error', () => {
				res.writeHead(500, 'Server Error');
				res.end('Request Error');
			});
			req.pipe(rs);
		}
		else if (remote === null)
		{
			res.writeHead(204);
			res.end();
		}
		else
		{
			res.writeHead(500, 'No Remote Server Match');
			res.end('Request Error');
		}
	},
	/* websocket请求代理转发 */
	onUpgrade: function(req, socket, head)
	{
		var remote = this.getRemote(req, true);
		if (remote)
		{
			socket.pause();
			var rs = net.connect.apply(net, remote);
			rs.on('error', (err) => {
				if (head)
				{
					socket.end(
						'HTTP/1.1 500 Socket Server Error\r\n'+
						'Connection: close\r\n'+
						'Content-Length:0\r\n\r\n'
					);
				}
				else
				{
					socket.end();
				}
			});
			rs.on('connect', () => {
				var data = `GET ${req.url} HTTP/1.1\r\n`;
				var hds = req.rawHeaders;
				for (var i=0,len=hds.length-1; i<len;)
				{
					data += hds[i++] + ': ' + hds[i++] + '\r\n';
				}
				var client_ip = (req.headers && req.headers['x-forwarded-for']) ||
								(req.connection && req.connection.remoteAddress) ||
								socket.remoteAddress;
				data += '__client__ip__: ' + client_ip + '\r\n';

				data += '\r\n';
				rs.write(data);
				if (head && head.length)
				{
					rs.write(head);
				}
				rs.pipe(socket);
				socket.pipe(rs);
				socket.resume();
				head = null;
			});
		}
		else
		{
			socket.end(
				'HTTP/1.1 500 No Remote Server Match\r\n'+
				'Connection: close\r\n'+
				'Content-Length:0\r\n\r\n'
			);
		}
	},
	/* 匹配HTTP请求路径 */
	getRemote: function(req, only_opts)
	{
		// 匹配HTTP请求路径
		var remotes = this._remotes;
		var uri = req.url;
		var item;
		var data;

		for (var pos=0; pos<remotes.length; pos++){
			item = remotes[pos];
			if (uri.indexOf(item.uri) === 0){
				// 匹配到对应的uri路径请求
				if (item.remote)
				{
					if (only_opts)
					{
						return item._opts;
					}
					// gen the request object
					data = item._opts;
					var opts = {
						'method': req.method,
						'path': uri,
						'headers': req.headers
					};

					// proxy 2 remote root
					if (item.remoteRoot) {
						opts.path = item.remoteRoot + uri.substr(item.uri.length);
					}

					if ('string' == typeof(data[0]))
					{
						opts['socketPath'] = data[0];
					}
					else
					{
						opts['port'] = data[0];
						if (data[1])
						{
							opts['host'] = data[1];
						}
					}
					return opts;
				}
				else
				{
					return null;
				}
			}
		}
		return false;
	}
});