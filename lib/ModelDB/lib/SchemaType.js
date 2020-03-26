/**
 * ModelDB SchemaType
 * ---------------------
 * 数据类型基类
 *
 */

'use strict';
function SchemaType (path, options, instance) {
  this.path = path;
  this.instance = instance;
  this.options = options;
  this.isPK = false;
  this.defaultValue;    //创建时默认值, 创建时赋予的默认值
  this.defaultSaveValue;//保存时默认值, 保存时才赋的默认值

  for (var i in options) if (this[i] && 'function' == typeof this[i]) {
    var opts = Array.isArray(options[i])
      ? options[i]
      : [options[i]];

    this[i].apply(this, opts);
  }
};

/*SchemaType.prototype.cast = function(val) {
	return val;
}

SchemaType.prototype.uncast = function(val) {
	return val;
}*/

//定义可用配置
//默认值
SchemaType.prototype.default = function (val) {
  if (1 === arguments.length) {
    this.defaultValue = typeof val === 'function'
      ? val
      : this.format(val);
    return this;
  }
  return this.defaultValue;
};

//保存时默认值
SchemaType.prototype.def_save = function (val) {
  if (1 === arguments.length) {
    this.defaultSaveValue = typeof val === 'function'
        ? val
        : this.format(val);
    return this;
  }
  return this.defaultSaveValue;
};

//保存时转换函数
SchemaType.prototype.format = function (val) {
  if ( typeof val === 'function' ) {
    this.formatFun = val;
    return this;
  } else if ( this.formatFun ) {
    return this.formatFun(val);
  }

  return val;
}

//内部函数
//父字段
SchemaType.prototype.parent = function() {
  var pieces = this.path.split('.');
  pieces.pop();
  return pieces.pop();
}

//字段名
SchemaType.prototype.fieldName = function() {
  var pieces = this.path.split('.');
  return pieces.pop();
}
/* 是否为嵌套 */
SchemaType.prototype.isNested = function() {
  return this.options && this.options['isNested'];
}
/* 设置pk */
SchemaType.prototype.pk = function(val){
  this.isPK = !!val;
}

/*!
 * Module exports.
 */
module.exports = SchemaType;
