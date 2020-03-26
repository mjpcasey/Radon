/**
 * @file radon系统错误码
 */
module.exports = {
	0: '没有错误'
	,600: '没有找到指定GID的分组ID记录'

	// util.js 错误代码
	,1000: '创建目录失败, 路径已经存在, 但不是目录类型'
	,1001: '创建目录失败: %0 (%1)'

	// ModelDB: 错误代码
	,2000: 'Insert Failed'
	,2001: 'Delete Failed'
	,2002: 'Find And Update Failed'
	,2003: 'Update Failed'
	,2004: 'Schema not found: %0'
	,2005: 'ModelDB no server setting'
	,2006: 'ModelDB Server [%0] not config'
	,2007: 'ModelDB not support database driver: %0'
	,2008: 'Get Collection Failed'
	,2009: 'Select Failed'
	,2010: 'Aggregate Failed'
	,2011: 'Count Failed'
	,2012: 'Distinct Failed'
	,2013: 'FindOne And Update Failed'

	// process.js 错误代码
	,3000: '没有找到对应的模块处理事件 %0.%1:%2'
	,3001: '没有找到对应的进程 %0'
	,3002: '当前的消息不是一个请求消息, 无法使用reply()方法返回消息'
	,3003: '当前的消息不是一个请求消息, 无法使用error()方法返回错误'
	,3004: '当前请求结果已经返回, 不允许重复返回信息'
	,3005: '请求没有任何回复结果 %0.%1:%2'
	,3006: '工作进程退出: 进程ID: %d, 错误码: %d, 退出信号: %s'
	,3007: '进程已关闭, 事务操作需要终止'
	,3008: 'Force End The Process'

	// router.js 路由错误信息
	,3100: '没有找到对应方法的处理路由配置 (%0)'

	// socket.js WebSocket模块错误
	,3200: '注册链接对象失败'

	// transport.js 错误代码
	,3300: '没有配置 radon.transport.session, 没法找到会话管理模块'
	,3301: '没有配置 radon.transport.link, 没法找到链接管理模块'
	,3302: '没有配置 radon.transport.router, 没法找到路由管理模块'
	,3304: '请求响应超时.'

	// user right 错误代码
	,4000: '用户还没有登陆'
	,4001: '用户缺少必要的权限: {$0}'

	// xss检查
	,5001: '输入内容存在危险字符, 字段: %0'
};