/** @format */

const express = require('express');

const router = express.Router();
const fpl = require('./controllers/fpl');

router.get('/', fpl.index);
router.get('/stats', fpl.stats);

module.exports = router;
