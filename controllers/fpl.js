'use strict';
const request = require('request');
const logger = require('../utils/logger');
const fplUrl = 'https://fantasy.premierleague.com/drf/';
const Handlebars = require('../utils/handlebar-helper');
let gameDetails;
let footballers = {};
const players = {};
let overallTable;
let tables = [];
let time = new Date();
function timeToLoad() {
  let timeToLoad = new Date() - time;
  timeToLoad /= 1000;
  return ' in ' + timeToLoad + ' secs';
}

const cup = [];
let cupTables = [];
let counter = 0;
let loading = true;
let requestOptions = {
  url: fplUrl,
  method: 'GET',
  json: {},
};

const fpl = {

  getGameDetails() {
    time = new Date();
    requestOptions.url = fplUrl + 'bootstrap-static';
    request(requestOptions, async (error, response, body) => {
      gameDetails = await {
        thisGameWeek: body['current-event'],
        nextGameWeek: body['next-event'],
        months: body.phases,
      };
      if (gameDetails.thisGameWeek < 38) {
        gameDetails.nextDeadline = body.events[gameDetails.thisGameWeek].deadline_time;
        gameDetails.thisGameWeekFinished = body.events[gameDetails.thisGameWeek - 1].finished;
      }

      gameDetails.months.forEach((month) => {
        delete month.id;
      });
      let currentMonth;
      for (let i = 1; i < 10; i++) {
        if (gameDetails.thisGameWeek >= gameDetails.months[i].start_event &&
            gameDetails.thisGameWeek <= gameDetails.months[i].stop_event) {
          currentMonth = gameDetails.months[i].name;
        }
      }

      gameDetails.currentMonth = currentMonth;

      body.elements.forEach(function (element) {
        footballers[element.id] = element;//element_type=position
      });

      logger.info('Got game details' + timeToLoad());
      fpl.getPlayers(6085);
    });
  },

  getPlayers(leagueId) {
    requestOptions.url = fplUrl + 'leagues-classic-standings/' + leagueId;
    request(requestOptions, async (err, response, body) => {
      const results = await body.standings.results;
      for (let result of results) {
        players[result.entry] = result;
        players[result.entry].liveWeekTotal = 0;
        fpl.getTeams(players[result.entry]);
        fpl.getTransfers(players[result.entry]);
      }

      logger.info(results.length + ' players retrieved' + timeToLoad());
    });
  },

  getTeams(player) {
    requestOptions.url = fplUrl + 'entry/' + player.entry + '/event/' + gameDetails.thisGameWeek + '/picks';
    request(requestOptions, async (err, response, body) => {
      const picks = await body.picks;
      let team = [];
      for (let i = 0; i < picks.length; i++) {
        picks[i].name = footballers[picks[i].element].web_name;
        picks[i].playingPosition = footballers[picks[i].element].element_type;
        team.push(picks[i]);
        if (picks[i].is_captain) {
          player.captain = picks[i].name;
        }
      }

      let df = 0;
      let mf = 0;
      let fw = 0;
      let j = 1;
      while (team[j].playingPosition === 2) {
        df++;
        j++;
      }

      while (team[j].playingPosition === 3) {
        mf++;
        j++;
      }

      while (team[j].playingPosition === 4) {
        fw++;
        j++;
      }

      player.formation = df + '-' + mf + '-' + fw;

      const transferDetails = await {
        chip: body.active_chip,
        transfers: body.entry_history.event_transfers,
        pointsHit: body.entry_history.event_transfers_cost * -1,
      };

      player.team = team;
      player.transferDetails = transferDetails;
      fpl.getScores(player);
    });
  },

  getScores(player) {
    requestOptions.url = fplUrl + 'entry/' + player.entry + '/history';
    request(requestOptions, async (err, response, body) => {
      const totalTransfers = await body.entry.total_transfers;
      const details = await body.history;
      let weekScores = {};
      details.forEach(function (gameWeek) {
        weekScores[gameWeek.event] = gameWeek;
        weekScores[gameWeek.event].netScore = weekScores[gameWeek.event].points - weekScores[gameWeek.event].event_transfers_cost;
      });

      player.transferDetails.totalTransfers = totalTransfers;

      player.weekScores = weekScores;
      logger.info('retrieved scores for ' + player.player_name + timeToLoad());

      player.team.forEach(function (footballer) {
        fpl.getLiveScores(player, footballer);
      });

      fpl.getMonthScores(player);

    });
  },

  getLiveScores(player, footballer) {
    requestOptions.url = fplUrl + 'element-summary/' + footballer.element;
    request(requestOptions, async (err, response, body) => {
      const scoreTypes = await body.explain['0'].explain;
      let points = 0;
      for (let i = 0; i < Object.keys(scoreTypes).length; i++) {
        let key = Object.keys(scoreTypes)[i];
        points += scoreTypes[key].points;
      }

      if (body.explain['0'].fixture.stats.length > 0) {

        const bpsAway = body.explain['0'].fixture.stats[9].bps.a;
        const bpsHome = body.explain['0'].fixture.stats[9].bps.h;
        const bps = bpsAway.concat(bpsHome);
        bps.sort(function (a, b) {
          return b.value - a.value;
        });

        let threeBonusCount = 0;
        let twoBonusCount = 0;
        let oneBonusCount = 0;
        let i = 0;
        while (bps[0].value === bps[i].value) {
          threeBonusCount++;
          i++;
        }

        while (threeBonusCount === 1 && bps[threeBonusCount].value === bps[i].value) {
          twoBonusCount++;
          i++;
        }

        while (threeBonusCount + twoBonusCount === 2 && bps[threeBonusCount + twoBonusCount].value === bps[i].value) {
          oneBonusCount++;
          i++;
        }

        let bonus = 0;
        let j = 0;
        while (j < threeBonusCount) {
          if (bps[j].element === footballer.element) {
            bonus = 3;
          }

          j++;
          while (j < threeBonusCount + twoBonusCount) {
            if (bps[j].element === footballer.element) {
              bonus = 2;
            }

            j++;
            while (j < threeBonusCount + twoBonusCount + oneBonusCount) {
              if (bps[j].element === footballer.element) {
                bonus = 1;
              }

              j++;
            }
          }
        }

        if (!scoreTypes.bonus) {
          points += bonus;
        }

        points *= footballer.multiplier;
        if (footballer.position <= 11) {
          player.liveWeekTotal += points;
        }

        player.weekScores[gameDetails.thisGameWeek].points = player.liveWeekTotal;
        player.weekScores[gameDetails.thisGameWeek].netScore =
            player.liveWeekTotal - player.weekScores[gameDetails.thisGameWeek].event_transfers_cost;

        if (body.explain['0'].explain.minutes.value === 0
            && body.explain['0'].fixture.started === true) {
          points = '-';
        }

        footballer.liveScore = points;
      }
    });
  },

  getMonthScores(player) {
    let points = 0;
    let monthScore = {};
    let i = 1;
    let j = 1;
    while (i < gameDetails.nextGameWeek) {
      if (i >= gameDetails.months[j].start_event && i <= gameDetails.months[j].stop_event) {
        points = 0;
        j++;
      }

      points += player.weekScores[i].netScore;
      monthScore[gameDetails.months[j - 1].name] = points;
      i++;
    }

    logger.info('retrieved month scores for ' + player.player_name + timeToLoad());

    player.monthScores = monthScore;

    counter++;
    if (counter === Object.keys(players).length) {
      tables = [];
      fpl.createTables();
      fpl.overallTable();
      counter = 0;
    }
  },

  createTables() {
    logger.info('Creating tables');
    let i = 1;
    while (i < gameDetails.months.length) {
      const table = {
        month: gameDetails.months[i].name,
        content: fpl.createTable(gameDetails.months[i].name),
        prize: 5 * (gameDetails.months[i].stop_event - gameDetails.months[i].start_event + 1),
      };
      tables.push(table);
      if (table.month === gameDetails.currentMonth) {
        break;
      }

      i++;
    }
  },

  overallTable() {
    let table = [];
    Object.keys(players).forEach(function (player) {
      const entry = {
        name: players[player].player_name,
      };

      let score = 0;
      Object.keys(players[player].weekScores).forEach(function (weekScore) {
        score += players[player].weekScores[weekScore].netScore;
      });

      entry.score = score;
      table.push(entry);
    });

    table.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;
      return scoreB - scoreA;
    });

    table[0].prize = '€240';
    table[1].prize = '€80';

    overallTable = table;
    logger.info('Overall table created ' + timeToLoad());
    fpl.cup();
  },

  createTable(month) {
    const table = [];
    Object.keys(players).forEach((player) => {
      const entry = {
        name: players[player].player_name,
        score: players[player].monthScores[month],
      };
      table.push(entry);
    });

    table.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;
      return scoreB - scoreA;
    });
    logger.info('table created for ' + month + ' ' + timeToLoad());
    return table;
  },

  getTransfers(player) {
    requestOptions.url = fplUrl + 'entry/' + player.entry + '/transfers';
    request(requestOptions, async (err, response, body) => {
      const transferHistory = await body.history;
      transferHistory.forEach(function (transfer) {
        transfer.playerIn = footballers[transfer.element_in].web_name;
        transfer.playerOut = footballers[transfer.element_out].web_name;
        if (transfer.event === gameDetails.thisGameWeek) {
          transfer.latest = true;
        }
      });

      player.transferHistory = transferHistory;
      logger.info('transfer info retrieved for ' + player.player_name + timeToLoad());
    });
  },

  cup() {
    const cupWeeks = [1, 8, 15, 22, 30, 38];
    cupWeeks.forEach(function (gameWeek) {
      let matchDay = {
        gameWeek: gameWeek,
        events: {},
      };
      cup.push(matchDay);
    });

    function Event(name) {
      this.name = name;
      this.fixtures = [];
    }

    cup[0].events.superCup = new Event('Super Cup');
    cup[0].events.qualifiers = new Event('Qualifiers');
    for (let i = 1; i < 6; i++) {
      if (i < 4) {
        cup[i].events.groupA = new Event('Group A');
        cup[i].events.groupB = new Event('Group B');
      }

      cup[i].events.scruds = new Event('Scruds');
    }

    cup[4].events.semiFinal = new Event('Semi-Final');
    cup[5].events.final = new Event('Final');

    function getWinner(match, gameWeek, league) {
      let winner;
      let loser;
      let draw = false;
      if (match.score1 > match.score2) {
        winner = match.team1;
        loser = match.team2;
      } else if (match.score1 < match.score2) {
        winner = match.team2;
        loser = match.team1;
      } else {
        winner = 'Draw';
        loser = 'Draw';
        draw = true;
      }

      match.winner = winner;
      match.loser = loser;

      if (league) {
        addPoints(winner, loser, gameWeek);

        if (draw) {
          addDrawPoints(match.team1, match.team2, gameWeek);
        }
      }
    }

    function addPoints(winner, loser, gameWeek) {
      winner.tableEntry.played++;
      winner.tableEntry.won++;
      winner.tableEntry.for += winner.weekScores[gameWeek].netScore;
      winner.tableEntry.against += loser.weekScores[gameWeek].netScore;
      winner.tableEntry.points += 3;
      logger.debug(winner.player_name + ' ' + winner.tableEntry.for);

      loser.tableEntry.played++;
      loser.tableEntry.lost++;
      loser.tableEntry.for += loser.weekScores[gameWeek].netScore;
      loser.tableEntry.against += winner.weekScores[gameWeek].netScore;
      logger.debug(loser.player_name + ' ' + loser.tableEntry.for);
    }

    function addDrawPoints(team1, team2, gameWeek) {
      team1.tableEntry.played++;
      team1.tableEntry.drawn++;
      team1.tableEntry.for += team1.weekScores[gameWeek].netScore;
      team1.tableEntry.against += team2.weekScores[gameWeek].netScore;
      team1.tableEntry.points++;

      team2.tableEntry.played++;
      team2.tableEntry.drawn++;
      team2.tableEntry.for += team2.weekScores[gameWeek].netScore;
      team2.tableEntry.against += team1.weekScores[gameWeek].netScore;
      team2.tableEntry.points++;
    }

    function Fixture(team1, team2, gameWeek, league) {
      this.team1 = team1;
      this.team2 = team2;
      if (gameWeek <= gameDetails.thisGameWeek) {
        this.score1 = team1.weekScores[gameWeek].netScore;
        this.score2 = team2.weekScores[gameWeek].netScore;
        if (gameDetails.thisGameWeekFinished) {
          getWinner(this, gameWeek, league);
        }
      }
    }

    function createMatches(matchDay, event, teams, gameWeek, league) {
      const noOfMatches = teams.length / 2;
      for (let i = 0; i < noOfMatches; i++) {
        cup[matchDay].events[event].fixtures.push(
            new Fixture(teams[i * 2], teams[i * 2 + 1], gameWeek, league));
      }
    }

    const superCup = [
      players[1940767],
      players[998490],
    ];
    createMatches(0, 'superCup', superCup, cupWeeks[0], false);
    const qualifiers = [
      players[119880],
      players[2089907],//0
      players[330128],
      players[1952631],//1
      players[1974840],
      players[18217],//2
      players[2849225],
      players[319619],//3
      players[4045],
      players[1660123],//4
    ];
    createMatches(0, 'qualifiers', qualifiers, cupWeeks[0], false);
    const bye = players[1971796];

    function TableEntry() {
      this.played = 0;
      this.won = 0;
      this.drawn = 0;
      this.lost = 0;
      this.for = 0;
      this.against = 0;
      this.difference = function () {
        return this.for - this.against;
      };

      this.points = 0;
    }

    Object.keys(players).forEach(function (player) {
      players[player].tableEntry = new TableEntry();
    });

    const groupA = [//1234,1324,1423
      cup[0].events.qualifiers.fixtures[4].winner,//cn
      cup[0].events.qualifiers.fixtures[3].winner,//pok
      cup[0].events.superCup.fixtures[0].winner,//pk
      cup[0].events.superCup.fixtures[0].loser,//ros
    ];
    const groupB = [//1234,1324,1423
      bye,//mc
      cup[0].events.qualifiers.fixtures[1].winner,//bd
      cup[0].events.qualifiers.fixtures[0].winner,//mg
      cup[0].events.qualifiers.fixtures[2].winner,//md
    ];
    const scruds = [// 1234, 1325, 1524, 1435, 2345
      cup[0].events.qualifiers.fixtures[2].loser,//mn
      cup[0].events.qualifiers.fixtures[0].loser,//dm
      cup[0].events.qualifiers.fixtures[3].loser,//jm
      cup[0].events.qualifiers.fixtures[1].loser,
      cup[0].events.qualifiers.fixtures[4].loser,//pb
    ];

    function CupTable(name, group) {
      this.name = name;
      this.group = group;
    }

    cupTables = {
      groupA: new CupTable('Group A', groupA),
      groupB: new CupTable('Group B', groupB),
      scruds: new CupTable('Scruds', scruds),
    };

    function sortGroup(group) {
      group.sort(function (a, b) {
        if (a.tableEntry.points !== b.tableEntry.points) {
          return b.tableEntry.points - a.tableEntry.points;
        } else {
          return b.tableEntry.difference() - a.tableEntry.difference();
        }
      });
    }

    createMatches(1, 'groupA', groupA, cupWeeks[1], true);
    createMatches(1, 'groupB', groupB, cupWeeks[1], true);
    const scruds1 = scruds.slice(0, 4);
    createMatches(1, 'scruds', scruds1, cupWeeks[1], true);
    Object.keys(cupTables).forEach(function (group) {
      sortGroup(cupTables[group].group);
    });

    const elite2a = [groupA[0], groupA[2], groupA[1], groupA[3]];
    createMatches(2, 'groupA', elite2a, cupWeeks[2], true);
    const elite2b = [groupB[0], groupB[2], groupB[1], groupB[3]];
    createMatches(2, 'groupB', elite2b, cupWeeks[2], true);
    const scruds2 = [scruds[0], scruds[2], scruds[1], scruds[4]];
    createMatches(2, 'scruds', scruds2, cupWeeks[2], true);
    Object.keys(cupTables).forEach(function (group) {
      sortGroup(cupTables[group].group);
    });

    const elite3a = [groupA[0], groupA[3], groupA[1], groupA[2]];
    createMatches(3, 'groupA', elite3a, cupWeeks[3], true);
    const elite3b = [groupB[0], groupB[3], groupB[1], groupB[2]];
    createMatches(3, 'groupB', elite3b, cupWeeks[3], true);
    const scruds3 = [scruds[0], scruds[4], scruds[1], scruds[3]];
    createMatches(3, 'scruds', scruds3, cupWeeks[3], true);
    Object.keys(cupTables).forEach(function (group) {
      sortGroup(cupTables[group].group);
    });

    function Placeholder(name) {
      this.player_name = name;
    }

    let semi = [
      new Placeholder('Winner Group A'),
      new Placeholder('Runner-up Group B'),
      new Placeholder('Winner Group B'),
      new Placeholder('Runner-up Group A'),
    ];
    if (cupWeeks[3] <= gameDetails.thisGameWeek && gameDetails.thisGameWeekFinished) {
      semi = [
        cupTables.groupA.group[0],
        cupTables.groupB.group[1],
        cupTables.groupB.group[0],
        cupTables.groupA.group[1],
      ];
    }

    createMatches(4, 'semiFinal', semi, cupWeeks[4], false);

    const scruds4 = [scruds[0], scruds[3], scruds[2], scruds[4]];
    createMatches(4, 'scruds', scruds4, cupWeeks[4], true);
    sortGroup(cupTables.scruds.group);

    let final = [
      new Placeholder('Winner Semi-Final 1'),
      new Placeholder('Winner Semi-Final 2'),
    ];
    if (cupWeeks[4] <= gameDetails.thisGameWeek && gameDetails.thisGameWeekFinished) {
      final = [
        cup[4].events.semiFinal.fixtures[0].winner,
        cup[4].events.semiFinal.fixtures[1].winner,
      ];
    }

    createMatches(5, 'final', final, cupWeeks[5], false);
    const scruds5 = scruds.slice(1);
    createMatches(5, 'scruds', scruds5, cupWeeks[5], true);
    sortGroup(cupTables.scruds.group);
  },

  index(request, response) {

    const playersSorted = [];
    Object.keys(players).forEach(function (player) {
      playersSorted.push(players[player]);
    });

    playersSorted.sort(function (a, b) {
      if (a.total !== b.total) {
        return b.total - a.total;
      } else {
        return a.transferDetails.totalTransfers - b.transferDetails.totalTransfers;
      }
    });
    const viewData = {
      title: 'Welcome',
      players: playersSorted,
      gameDetails: gameDetails,
      tables: tables,
      loading: loading,
      overallTable: overallTable,
      cup: cup,
      cupTables: cupTables,
    };
    logger.info('Rendering index');
    response.render('index', viewData);
  },

};

module.exports = fpl;
