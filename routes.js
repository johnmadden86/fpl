'use strict';

const express = require('express');
const router = express.Router();
const fpl = require('./controllers/fpl');

router.get('/', fpl.index);

module.exports = router;
