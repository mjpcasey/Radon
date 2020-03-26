/**
 * @file Radon Const Type
 */

function def (name, value) {
	exports.__defineGetter__(name, function(){ return value; });
}
/* 管理进程 [ChildProcess NodeProcess] 的事件类型 */
def('MSG_REQ', 'admin');
def('MSG_ACK', 'ack_admin');
def('MSG_IPC', 'ipc');
def('MSG_LOG', 'log');
def('MSG_EXCEPTION', 'exception');
def('MSG_SYS', 'sys');
def('MSG_CLEAR', 'clear');
def('MSG_INIT', 'init');
def('MSG_INITED', 'inited');
/* 运行状态 */
def('STATUS_CLEAR', 'clear');
def('STATUS_STOPPING', 'stopping');
def('STATUS_STOP', 'stop');
