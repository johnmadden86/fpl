/** @format */

const express = require('express');
// const logger = require('./utils/logger');
const exphbs = require('express-handlebars');

const app = express();
app.engine('.hbs', exphbs({ extname: '.hbs', defaultLayout: 'main' }));
app.set('view engine', '.hbs');
const routes = require('./routes');

app.use('/', routes);
const fpl = require('./controllers/fpl');

const listener = app.listen(process.env.PORT || 4000, () => {
  console.log(`Your app is listening on port ${listener.address().port}`);
  fpl.runApp();
});
