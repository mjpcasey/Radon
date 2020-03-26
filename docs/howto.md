
radon的说明
=====================

说明`process` `module` 的一些结构,来更好地去写业务代码.

----------


process
---------
一个进程,包括若干个module,主要功能是提供进程间的通信--`TCP`. 每个进程都有唯一的名字识别.

1. 写业务可能会用到或需要了解的属性包括:
	- `$` 所有的子模块 module 集合. 每个进程必须会有一个模块 `sessionManagerClient`(简称`SMC`)(除了`sessionManager`,简称`SM`) . 用于同步注册信息.每个模块建立时都会向`SM`注册.`SM`会向已经注册的`SMC`发同步注册信息.
	- `$CONFIG` ,外部的`js配置`都在这,可以直接调用.
	- `$isMaster` ,标志是不是`SM`.
	- `$processName` , 进程的名字,在配置文件里指定的.


2. 写业务可能会用到或需要了解的方法包括:
	- `getSession()` 得到所有的注册信息 就是`SMC`同步而来的注册信息.



module
----------

模块都是继承于`pubjs`下的`module`模块.主要作用业务处理.继承于`Emitter`模块(这块基本上写业务不会碰到,是在底层用到的.).

1. 写业务可能会用到或需要了解的属性包括:
	- `$wid`    , 每个模块注册了都会有一个`wid`返回用于唯一标识,底层会根据wid来查找会话,得知其所属`process` ,自的`moduleName`等信息.
	- `$moduleName` , 模块的名字, 配置文件里指定
	- `$IPC`    , `process`模块的`TCP指针`,用其发送消息.
	- `$CONFIG` ,外部的js配置都在这,可以直接调用.
	- `$ipcSend`  , 模块的发送消息方法,参数有三个,第一个是进程的`名字`,第二个是`header`, 第三个是`附带参数`.

2. 详细说明:
	- `@param target {String}`  目标process的名字,可省略(如省,默认发送到`ROUTER`进程里,再进行分发到相应的`业务模块`)
	- `@param header {Object}`  发送的信息头,属性:

```
	{
		type:  int(不用手动填,自动的)   //消息的类型,当前有四种类型,request,reponse,send,reply
		targetModule: String(option) // 目标模块, 可省,如省就直接发给目标进程的全部子模块,不省就直接发给相应的目标模块.
		sourceModule: String //来源模块, 这个是默认填写的,不用填写.
		msgType:    String  // 消息名称, 当目标进程接收到消息时,会把msgType 作为信息名称发送出去(Emitter).
		wid:        int(option)    // 每个模块注册了都会有一个wid返回用于唯一标识, 默认是填写自身的wid,也可以手动填写.
		msgId: int  // 消息id 可选.
	}
```
   -  `@param param {object}`   附带的参数.

```
		self.$ipcSend = function(target,header,param){
			if(!util.isString(target)){
				param = header;
				header = target;
				target = null;
			}
			header.sourceModule = self.$moduleName;
			header.type = MSGTYPE.SENDMSG;
			header.wid = header.wid || self.$wid;
			self.$IPC.ipcSend.apply(self.$IPC,[target,header,param]);
		};

```

3. 写业务可能会用到或需要了解的方法包括:
	- `init()` 必须要实现的方法,且要调用 `this.Super('init',arguments);` 主要是初始化整个模块并进行相应的模块配置.
	- `getEvents()` 必须要实现的方法, 模块要监听到消息都是在这里定义.数据里必须要包括`['registerWid',this.registerWid]. `这个以后可改进.

```
var mod = base.extend({
	"init": function(){
		var self = this;
		self.Super('init',arguments);
	}
	,"getEvents": function(){
		return [
			["registerWid",this.registerWid]    //第一个参数就是msgType了, 第二个参数是处理方法.在pubjs的module已经处理.
		];
	}
	,"destroy": function(){
		this.Super('destroy');
		this.$ipcSend = null;
	}

});

```

配置文件:
----------

1. 配置文件是写在`radon`外面.亦可看`radon/test`下面的结构.
	- `/test/data/host.js `  每个进程的`ip port`的配置,结构如下:
        - `group` : 属于那个组,用于群发.
        - `isBus`: 标志是不是业务模块,如果是会自动发注册信息到路由模块(所有的业务模块都要向路由模块注册).


```
module.exports = {
	"INTERFACE": {
		"port": 5555
		,"host":"127.0.0.1"
		,"group": ["sessionClient"]
	}
	,"ROUTER": {
		"port": 6666
		,"host":"127.0.0.1"
		,"group": ["sessionClient"]
		,"isRouter": true
	}
	,"USERCENTER": {
		"port": 8888
		,"isBus": true
		,"host":"127.0.0.1"
		,"group": ["sessionClient"]
	}
	,"SESSIONMANAGER": {
		"port": 4444
		,"host":"127.0.0.1"
		,"group": []
		,"isSessionManager": true
	}
	//....
}

```


此文件基本上是各个项目共享的.

2. `/test/data/config.js` 是整个框架的配置.
	- `ModelDB`,数据库的引用,可直接调用.
	- 可追加很多配置,喜欢加什么就加什么咯~~
	- `processesNode`: 对于在node运行的进程(因为`socketio`的原因)
	- `processes`: `fibjs` 进程的配置,
	- 属性的名称就是进程名称,里面再配置相应的模块和一些进程的属性.


```
var processes = {
	"SESSIONMANAGER":{
		"modules":[
			{
				"route":"/lib/modules/sessionManager.js"    //如果路径在项目外面,一般都是在外面的,就写成/../这样形式打头.
				,"name": "sessionManager"
			}
		]
		,"timeOut": 500
		,"isMaster": true
	}
	//...
}
```


- `routeMap`,   业务的业务映射,现在这个只是简单的映射,以后很可能会扩展.举个例子:
 - userCenter的业务模块某个请求: 从接口发送到业务里是这样:
 - `/userCenter/user/list`
 - 去到路由里解析会变成:
 - `userCenter.user.list` ===> 然后把这个`msg` 匹配`routeMap`的属性.找到相应的模块名称和消息名称.


```
{
	 "userCenter.user.list":{
		"module": "userCenter"
		,"msg":"user.list"
	}
}
```





框架的起动:
----------
建议写在脚本,参考/test/run.cmd文件.


现在建立一个业务模块的整个过程(假定router , sm, socketio,等模块已经定义好了)
----------
当前目录结构:

```
/example
	/radon  --radon项目引入
	/data
		/config.js example项目的配置.
		/host.js   进程间的通信配置,直接复制过来.
	/modules    自定义的文件夹,可放模块文件.
		/example.js 将要添加的模块文件.
```


首先在`config.js` 里的`processes`添加一个新的进程(如果你不想新开一个进程,可直接在你想添加到进程里添加`modules`).在node运行的就放在`psNode`下,在fibjs就在`processes`下
下面是建立一个`example进程`并添加一个`example模块`.

```
processes = {
	... //前面的配置
	//下面是EXAMPLE进程新配置
	{
		EXAMPLE:{
			"modules":[
				{
				"route":"/../modules/example.js"
				,"name": "example"
				}
			]
			,"timeOut": 500 //这个是用于进程生成时,下一个进程生成需要等待的时间.可不要.
		}
	}
}


```


如果是新配置的进程,当然是要在`host.js`里配置相应的`ip` `port`了.

```
{
	...//前面的配置
	//下面是EXAMPLE进程新配置, 属性名一定要与process里对应.
	"EXAMPLE":{
		"port": 6789
		,"host":"127.0.0.1"
		,"group": ["sessionClient"]
	}
}

```


在`/modules/`下添加example模块文件: `example.js`

```
"use strict";

var radon = require('../radon')
	,base = radon.module
	,util = radon.util;

var mod = base.extend({
	"init": function(){
		var self = this;
		self.Super('init',arguments);
	}
	,"getEvents": function(){
		return [
			["registerWid",this.registerWid]
			,["example.operate",this.operate]
		];
	}
	,"operate": function(data,res,header){
		res.reply({msgType: "bsReply"},[
			{name:'a'}
			,{name:'ab'}
			,{name:'abc'}
			,{name:'abcd'}
		]);
	}
	,"destroy": function(){
		this.Super('destroy');
		this.$ipcSend = null;
	}

});

module.exports = new mod();

```


定义业务处理方法,直接在`getEvnets()`里添加,然后增加处理方法. 接口等模块发送到路由的请求信息的`param`必须包含: uri
uri 的格式为 `/xxx/yyy/zzz` , 然后在`routeMap`里一定要定义映射:

```
routeMap = {
	...//前面的配置
	//下面是EXAMPLE进程新配置, 属性名一定要与process里对应.
	'xxx.yyy.zzz':{
		module: 'example'
		,msg: 'example.operate'
	}
}
```


每个处理方法都会有三个默认参数:

```
	// data 消息带过来的param
	/* res 回复的对象包含:
		res.reply   ==>  直接回复去来源的模块里,第一个参数是header(msgType[这里我习惯在业务模块里写上bsReply的,没有限制死的这里],type,targetModule,sourceModule都已经写好,当然你可以覆盖.),第二个为param.
		res.cast    ==>  广播的功能,参考sessionManager:
		```
			if(status){
				res.cast('group/sessionClient',{sourceModule: this.$moduleName,msgType:'sync'},{session:this.$SESSION});    //这里是进程的组播,根据host的配置.
				//res.cast('C',this.$moduleName,"roomCast",{room: 'C'},wid);    //socketio 的广播,同一间公司
				//res.cast('A',this.$moduleName,"roomCast",{room: 'A'},wid);    //所有的客户端,
				//res.cast('S',this.$moduleName,"roomCast",{room: 'S'},wid);    //同一个用户登录的客户端
				res.cast('U',{wid: wid,sourceModule: this.$moduleName,msgType: "roomCast"},{room: 'U'});    //用户级广播.
			}

		```
		res.pass ==> 过渡给其他模块处理,自己不经手,参数序列跟ipcSend一样的,第一个为目标进程,第二个为header(type,soucreModle,wid,已经填好)
		res.request ==> 请求其它模块的处理,跟发送到路由找业务的操作是一样的,不同的只是这个是同步的,返回的是请求数据.超时会报错(返回的是{success:false}).



	*/
	"operate": function(data,res,header){

		res.reply({msgType: "bsReply"},{data:[
			{name:'a'}
			,{name:'ab'}
			,{name:'abc'}
			,{name:'abcd'}
		]});
	}

```


返回的`数据结构`定义, 业务里返回的数据直接放在param对象的data里就好,错误就直接放在`param`里的`error对象`里就好,没有错误,如果没有错误就不填`error`

```
	//第一个是header, 第二个参数是param.
	res.reply(headexx,{error: error, data: data});
```

接口返回给`前端的结构`为

```
{
	error: {message:'错误内容'} // 成功就没有error对象,失败就添加error对象.
	data: {object}    //data就是业务里返回的数据了
}
```

ok,` 添加业务模块`基本是这个过程了. 有什么不明白不清楚的请让我`(rirong)`知道,.