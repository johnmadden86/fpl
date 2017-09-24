'use strict';
const request = require('request');
const logger = require('../utils/logger');
const fplUrl = 'https://fantasy.premierleague.com/drf/';
let gameDetails;
const players = [];
let requestOptions = {
  url: fplUrl,
  method: 'GET',
  json: {},
};

const fpl = {

  //https://fantasy.premierleague.com/drf/event/i/live
  getGameDetails() {
    requestOptions.url = fplUrl + 'bootstrap-static';
    request(requestOptions, async (error, response, body) => {
      gameDetails = await {
        thisGameWeek: body['current-event'],
        nextGameWeek: body['next-event'],
        months: body.phases,
      };

      gameDetails.months.forEach(function (month) {
        delete month.id;
      });

      gameDetails.months.shift();
      if (gameDetails.thisGameWeek < 38) {
        gameDetails.nextDeadline = body.events[gameDetails.thisGameWeek].deadline_time;
      }

      let i = 0;
      let currentMonth;
      while (i < 10) {
        if (gameDetails.thisGameWeek >= gameDetails.months[i].start_event &&
            gameDetails.thisGameWeek <= gameDetails.months[i].stop_event) {
          currentMonth = gameDetails.months[i].name;
        }

        i++;
      }

      gameDetails.currentMonth = currentMonth;
      logger.debug('Got game details');
      fpl.getLeagueDetails(6085);
    });
  },

  getLeagueDetails(leagueId) {
    requestOptions.url = fplUrl + 'leagues-classic-standings/' + leagueId;
    request(requestOptions, async (err, response, body) => {
      const results = await body.standings.results;
      for (let result of results) {
        const player = {
          teamId: result.entry,
          playerName: result.player_name,
          teamName: result.entry_name,
          weekScores: [],
        };

        players.push(player);
      }

      logger.debug(players.length + ' players got');
      players.forEach(function (player) {
        fpl.getPlayerScores(player);
      });
    });
  },

  getPlayerScores(player) {
    let i = 1;
    while (i < gameDetails.nextGameWeek) {
      requestOptions.url = fplUrl + 'entry/' + player.teamId + '/event/' + i + '/picks';
      request(requestOptions, async (err, response, body) => {
        const details = await body.entry_history;
        const weekScore = {
          gameWeek: details.event,
          points: details.points,
          transfers: details.event_transfers,
          transferCost: details.event_transfers_cost,
        };
        weekScore.netScore = weekScore.points - weekScore.transferCost;
        player.weekScores.push(weekScore);
        if (player.weekScores.length === gameDetails.thisGameWeek) {
          player.weekScores.sort(
              function (a, b) {
                let gwA = a.gameWeek;
                let gwB = b.gameWeek;
                return gwA - gwB;
              });

          fpl.getMonthScores(player);
        }
      });

      i++;
    }

  },

  getMonthScores(player) {
    let i = 0;
    let j = 0;
    let points = 0;
    let monthScore = new Map();
    while (i < gameDetails.thisGameWeek) {
      let k = i + 1;
      if (k >= gameDetails.months[j].start_event &&
          k <= gameDetails.months[j].stop_event) {
        points = 0;
        j++;
      }

      points += player.weekScores[i].netScore;
      monthScore.set(gameDetails.months[j - 1].name, points);
      i++;
    }

    player.monthScores = monthScore;
  },

  createTable(month) {
    const table = [];
    players.forEach(function (player) {
      const entry = {
        name: player.playerName,
        score: player.monthScores.get(month),
      };
      table.push(entry);
    });

    table.sort(function (a, b) {
      let scoreA = a.score;
      let scoreB = b.score;
      return scoreB - scoreA;
    });

    return table;
  },

  index(request, response) {
    let i = 0;
    const tables = [];
    while (i < gameDetails.months.length) {
      const table = {
        month: gameDetails.months[i].name,
        content: fpl.createTable(gameDetails.months[i].name),
        prize: 5 * (gameDetails.months[i].stop_event - gameDetails.months[i].start_event + 1),
      };
      tables.push(table);
      if (gameDetails.months[i].name === gameDetails.currentMonth) {
        break;
      }

      i++;
    }

    const viewData = {
      title: 'Welcome',
      players: players,
      gameDetails: gameDetails,
      tables: tables,
    };
    logger.info('Rendering index');
    response.render('index', viewData);
  },

};

module.exports = fpl;
