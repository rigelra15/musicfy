'use strict';
const Service = require('webos-service');
const {startRuntime} = require('./runtime.cjs');
const {registerService} = require('./lifecycle.cjs');
registerService(new Service('com.musicfy.webos.service'),startRuntime);
