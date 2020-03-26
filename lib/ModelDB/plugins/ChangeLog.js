/**
 * @file 数据变更日志记录
 */
var util = require("../../core/util.js");
var Schema = require('../lib/Schema.js');

var Types = {
	ObjectId: Schema.Types.ObjectId
};

var Buffer = {
	isBuffer:function() {
		return false;
	}
};


/*var _isMongooseObject = function (v) {
  	return v instanceof mongoose.Document ||
		v instanceof mongoose.Types.Array ||
		v instanceof mongoose.Types.Buffer
}*/
var _deepEqual = function (a, b) {
  if (a === b) return true;

  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();

  if (a instanceof Types.ObjectId && b instanceof Types.ObjectId) {
    return a.toString() === b.toString();
  }

  if (typeof a !== 'object' && typeof b !== 'object')
    return a == b;

  if (a === null || b === null || a === undefined || b === undefined)
    return false

  if (a.prototype !== b.prototype) return false;

  // Handle MongooseNumbers
  if (a instanceof Number && b instanceof Number) {
    return a.valueOf() === b.valueOf();
  }

  if (Buffer.isBuffer(a)) {
    if (!Buffer.isBuffer(b)) return false;
    if (a.length !== b.length) return false;
    for (var i = 0, len = a.length; i < len; ++i) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  //if (_isMongooseObject(a)) a = a.toObject();
  //if (_isMongooseObject(b)) b = b.toObject();

  try {
    var ka = Object.keys(a),
        kb = Object.keys(b),
        key, i;
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }

  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;

  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();

  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }

  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }

  return true;
};

var _getChanges = function(old, last) {
	var result = {
		old: null,
		last: null
	};

	if ( !old && !last ) {
		return result;
	}
	if ( !old ) {
		result.last = last;
		return result;
	}
	if ( !last ) {
		result.old = old;
		return result;
	}

	var key, oldValue, lastValue;

	//对比
	for ( key in old ) {
		if ( !old.hasOwnProperty(key) || key === '_id' ) continue;
		oldValue = old[key];
		if ( (key in last) && last.hasOwnProperty(key) ) {
			lastValue = last[key];
			if ( !_deepEqual( oldValue, lastValue ) ) {
				if ( !result.old ) result.old = {};
				if ( !result.last ) result.last = {};
				result.old[key] = oldValue;
				result.last[key] = lastValue;
			}
		} else {
			if ( !result.old ) result.old = {};
			result.old[key] = oldValue;
		}
	}

	//last中多出来的值
	for ( key in last ) {
		if ( !last.hasOwnProperty(key) || ((key in old) && old.hasOwnProperty(key) ) ) continue;
		if ( !result.last ) result.last = {};
		result.last[key] = last[key];
	}

	return result;
};


/**
 * 对比old和last的不同并记录log
 */
var log = function(model, old, last, args) {

	var OPERATION_CREATE = 1;
	var OPERATION_MODIFY = 2;
	var OPERATION_REMOVE = 3;
	//var OPERATION_REVERT = 4;
	var ModelChangeLog = model.$db.model('lib/ModelChangeLog');

	var operation,
		modelId;
	if ( !old && !last ) {
		return false;
	} else if ( !old ) {
		operation = OPERATION_CREATE;
		modelId = last._id;
	} else if ( !last ) {
		operation = OPERATION_REMOVE;
		modelId = old._id;
	} else {
		operation = OPERATION_MODIFY;
		modelId = old._id;
	}

	var log = new ModelChangeLog();
	log.modelId = modelId;
	log.model = model.$modelName;
	log.operation = operation;

	var changes = _getChanges(old, last);

	log.old = changes.old;
	log.last = changes.last;

	if ( log.old === log.last && log.old === null) {
		return util.promiseResolve(); //没有变化，不记录
	}

	//钩子
	var preSave;
	if ( args && args.pre_save ) {
		preSave = args.pre_save(log);
	}

	// pre save is promise
	if(preSave && typeof preSave.then === 'function' ){
		return preSave.then(function(log){
			log.TS = new Date();
			return log.save();
		});
	}else{
		// preSave is log
		if(preSave){
			log = preSave;
		}

		log.TS = new Date();
		return log.save();
	}
};
/* 改变是日志写入 */
var addChangeLog = function(schema, args) {
	schema.pre('saveEx', function (next) {
		// var doLog = true && util.logEnabled();
		var self = this;
		var id =  self._id;
		if( self._id !== undefined ) {
			return self.getModel().findOne({_id: id}).then(function(old){
				if(old){
					self._old = old.toObject();
				}
				return next();
			});
		}else{
			return next();
		}
	});
	schema.post('saveEx', function (next, val) {
		var last = this.toObject();
		return log(this.getModel(), this._old, last, args).then(function(){
			return next(val);
		}).catch(function(){
			next(val);
		});
	});
};


module.exports = addChangeLog;