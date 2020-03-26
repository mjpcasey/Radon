/**
 * 文件服务
 */

 'use strict'
 var radon = require('../radon')
    , util = radon.util
    , fs = require('fs')
    , http = require('http')
    , path = require('path');
/**
 * srcFile:原文件路径，将此文件写到文件服务
 * buffer: 文件内容
 * config:配置
 */
 exports.write = util.generator(function*(srcFile, buffer, config) {
    if (!typeof srcFile ==='string') {
        config = buffer;
        buffer = srcFile;
    } else {
        config = buffer;
    }
    return util.promise(function(ok, fail) {
        var options = {
            host: config.host,
            port: config.port,
            method: 'PUT',
            path: config.write_url + config.path,
        };
        
        var hasTimeouted;
        var req = http.request(options, function(res) {
            let chunks = [];
            res.on('data', function(chunk) {
                chunks.push(chunk);
            });

            res.on('end',function() {
                try{
                    if (hasTimeouted) {
                        return;
                    }
                    if (chunks && chunks.length){
                        var ret = JSON.parse(chunks.join(''));
                        ret = {
                            path: ret.result.path,
                            size: ret.result.path
                        };
                        ok(ret);
                    } else {
                        ok(null);
                    }
                }
                catch(err) {
                    util.log(104, `FileService Error, ${err}`);
                    fail({message: 'FileService Error', err: err})
                }
            })
        });

        var remote = config.host + ':' + config.port;
        req.on('error', function(err) {
            util.log(104, `The Url Request Error ${remote}`);
			fail({code:509,message: radon.util.LANG('远程计算机拒绝连接: ' + remote)});
        });
        //读取要发送的文件
        if (srcFile) {
            var readStream = fs.createReadStream(srcFile);
            readStream.pipe(req);
        } else {
            req.write(buffer);
            req.end();
        }

        var timeout = config.timeout || 300000;
		if(timeout)
		{
			req.setTimeout(timeout, function() {
				util.log(104, `the http post timeout(${timeout/1000} sec) url: ${remote}`);
				hasTimeouted = true;
				req.abort();
				fail({code:509,message: radon.util.LANG('远程计算机超时: ' + remote)});
			});
		}
    });
 });

 //读文件
 exports.read = util.generator(function*(filePath, config) {   
     return util.promise(function(ok, fail) {
        var options = {
            host: config.host,
            port: config.port,
            method: 'GET',
            path: config.read_url + filePath,
        };

        var hasTimeouted;
        var req = http.request(options, function(res) {
            let chunks = [];
            res.on('data', function(chunk) {
                chunks.push(chunk);
            });

            res.on('end',function() {
                try{
                    if (hasTimeouted) {
                        return;
                    }
                    ok(Buffer.concat(chunks));
                }
                catch(err) {
                    util.log(104, `FileService Error, ${err}`);
                    fail({message: 'FileService Error', err: err})
                }
            });
        });

        var remote = config.host + config.port
        req.on('error', function(err) {
            util.log(104, `The Url Request Error ${remote}`);
			fail({code:509,message: radon.util.LANG('远程计算机拒绝连接: ' + remote)});
        });
        req.end();

        var timeout = config.timeout || 300000;
		if(timeout)
		{
			req.setTimeout(timeout, function() {
				util.log(104, `the http post timeout(${timeout/1000} sec) url: ${remote}`);
				hasTimeouted = true;
				req.abort();
				fail({code:509,message: radon.util.LANG('远程计算机超时: ' + remote)});
			});
		}
     });
 });

 /**
  * srcFile:原文件
  * dstFile: 目标地址
  * cover: 是否选择覆盖已经存在的目标文件
  */
 exports.copy = util.generator(function*(srcFile, dstFile, cover, config) {
    var options = {
        host: config.host,
        port: config.port,
        method: 'GET',
        path: config.copy_url + srcFile + '&dest=' + dstFile + '&force=' + cover,
    };
    var ret =  yield http_request(options);
    return ret;
 });

 exports.stat = util.generator(function*(filaPath, config) {
    var options = {
        host: config.host,
        port: config.port,
        method: 'GET',
        path: config.stat_url + filaPath,
    };
    var ret =  yield http_request(options);
    ret = ret.result;
    return ret;
 });

 exports.remove = util.generator(function*(filaPath, config) {
    var options = {
        host: config.host,
        port: config.port,
        method: 'GET',
        path: config.remove_url + filaPath,
    };
    var ret =  yield http_request(options);
    ret = ret.result;
    return ret;
 });

 exports.mediaInfo = util.generator(function*(filaPath, config) {
    var options = {
        host: config.host,
        port: config.port,
        method: 'GET',
        path: config.media_info_url + filaPath,
    };
    var ret =  yield http_request(options);
    ret = ret.result;
    return ret;
 });


 var http_request = function(options) {
    return util.promise(function(ok, fail){
        var hasTimeouted;
        var req = http.request(options, function(res) {
            let chunks = [];
            res.on('data', function(chunk) {
                chunks.push(chunk);
            });

            res.on('end',function() {
               try{
                    if (hasTimeouted) {
                        return;
                    }
                    var ret = JSON.parse(chunks.join(''));
                    ok(ret);
               } 
                catch(err) {
                    util.log(104, `FileService Error, ${err}`);
                    fail({message: 'FileService Error', err: err})
                }
            })
        });

        var remote = options.host + ':' + options.port;
        req.on('error', function(err) {
            util.log(104, `The Url Request Error ${remote}`);
			fail({code:509,message: radon.util.LANG('远程计算机拒绝连接: ' + remote)});
        });
        req.end();

        var timeout = options.timeout || 300000;
		if(timeout)
		{
			req.setTimeout(timeout, function() {
				util.log(104, `the http post timeout(${timeout/1000} sec) url: ${remote}`);
				hasTimeouted = true;
				req.abort();
				fail({code:509,message: radon.util.LANG('远程计算机超时: ' + remote)});
			});
		}
    })
 };