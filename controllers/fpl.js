/** @format */

const axios = require('axios');
// eslint-disable-next-line no-unused-vars
const Handlebars = require('../utils/handlebar-helper');

const leagueCode = 484626;

let time = new Date();
function timeToLoad() {
  let ttl = new Date() - time;
  ttl /= 1000;
  return ` in ${ttl} secs`;
}

const imageUrl = code =>
  `https://platform-static-files.s3.amazonaws.com/premierleague/photos/players/110x140/p${code}.png`;

// let cup;
// let cupTables = [];
let liveScoreCounter;
const loading = false;
const request = axios.create({
  baseURL: 'https://fantasy.premierleague.com/drf/',
  method: 'GET'
});

let staticData;

const arrToObj = arr => arr.reduce((obj, elem) => ({ ...obj, [elem.id]: elem }), {});

let users;

const fpl = {
  /*
  * Retrieve and assemble the data every 5 mins
  * --> get static data
  */
  runApp() {
    function run() {
      console.log('runApp');
      time = new Date();
      fpl.getStaticData();
    }
    try {
      run();
      setInterval(run, 1000 * 60 * 5);
    } catch (e) {
      throw e;
    }
  },

  /*
  * Retrieve and assemble the game's "static" data
  * --> live footballer scores
  * --> get league data
  */
  async getStaticData() {
    try {
      console.log('getStaticData');
      const footballers = arrToObj((await request('elements')).data);
      // console.log(`${Object.keys(footballers).length} footballers loaded in${timeToLoad()}`);
      const events = (await request('events')).data;
      // console.log(`${events.length} events loaded in${timeToLoad()}`);
      const currentGw = events.find(e => e.is_current === true);
      const nextGw = events.find(e => e.is_next === true);
      // console.log(`Current Gameweek: ${currentGw.id}, Next Gameweek: ${nextGw.id}`);
      // fixtures = (await request('fixtures')).data;
      const phases = (await request('phases')).data;
      // console.log(`${phases.length} phases loaded in${timeToLoad()}`);
      phases.forEach(phase => {
        phase.table = {
          name: phase.name,
          entries: []
        };
      });
      // teams = (await request('teams')).data;

      staticData = { footballers, events, currentGw, nextGw, phases };

      await this.liveFootballerScores(footballers);
      // console.log(footballers);
      this.getLeagueData(leagueCode);
    } catch (e) {
      throw e;
    }
  },

  /*
  * Calculate live matchday scores
  * --> get bonus
  * --> apply bonus
  */
  // eslint-disable-next-line no-shadow
  async liveFootballerScores(footballers) {
    try {
      console.log('liveFootballerScores');
      const { elements, fixtures } = (await request(`event/${staticData.currentGw.id}/live`)).data;
      Object.keys(footballers).forEach(footballer => {
        const { explain, stats } = elements[footballer];
        const fixtureId = explain[0][1];
        const details = explain[0][0];
        const minutes = details.minutes.value;
        const didNotPlay = minutes === 0;
        const points = stats.total_points;
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (fixture.started) {
          footballers[footballer].liveScore = didNotPlay ? '-' : points;
        }
      });

      fixtures.forEach(f => {
        const bonusApplied = f.stats[8] && f.stats[8].bonus.a.length + f.stats[8].bonus.h.length > 0;
        if (!bonusApplied) {
          const bonus = this.getBonus(f);
          this.applyBonus(footballers, bonus);
        }
      });

      console.log('live data gathered');
    } catch (e) {
      throw e;
    }
  },

  /*
  * Returns the players that have scored bonus points
  */
  getBonus(fixture) {
    const three = [];
    const two = [];
    const one = [];
    if (fixture.stats.length > 0) {
      const bpsAway = fixture.stats[9].bps.a;
      const bpsHome = fixture.stats[9].bps.h;
      const bps = bpsAway.concat(bpsHome);
      bps.sort((a, b) => b.value - a.value);

      let threeBonusCount = 0;
      let twoBonusCount = 0;
      let oneBonusCount = 0;
      let i = 0;
      while (bps[0].value === bps[i].value) {
        threeBonusCount += 1;
        i += 1;
      }

      while (threeBonusCount === 1 && bps[threeBonusCount].value === bps[i].value) {
        twoBonusCount += 1;
        i += 1;
      }

      while (threeBonusCount + twoBonusCount === 2 && bps[threeBonusCount + twoBonusCount].value === bps[i].value) {
        oneBonusCount += 1;
        i += 1;
      }

      let j = 0;
      while (j < threeBonusCount) {
        three.push(bps[j].element);
        j += 1;
        while (j < threeBonusCount + twoBonusCount) {
          two.push(bps[j].element);
          j += 1;
          while (j < threeBonusCount + twoBonusCount + oneBonusCount) {
            one.push(bps[j].element);
            j += 1;
          }
        }
      }
    }

    return {
      three,
      two,
      one
    };
  },

  /*
  * Adds bonus points to footballer's live total
  */
  applyBonus(footballers, bonus) {
    for (let i = 0; i < bonus.three.length; i += 1) {
      bonus.three.forEach(element => {
        footballers[element].liveScore += 3;
      });
    }

    for (let i = 0; i < bonus.two.length; i += 1) {
      bonus.two.forEach(element => {
        footballers[element].liveScore += 2;
      });
    }

    for (let i = 0; i < bonus.one.length; i += 1) {
      bonus.one.forEach(element => {
        footballers[element].liveScore += 1;
      });
    }
  },

  /*
  * Get user data for league
  * --> get user data
  */
  async getLeagueData(leagueId) {
    try {
      users = (await request(`leagues-classic-standings/${leagueId}`)).data.standings.results;
      console.log(`${users.length} users retrieved${timeToLoad()}`);
      await users.forEach((user, index) => {
        // users[index].prizeMoney = 0;

        // console.log(`Getting data for ${user.player_name}${timeToLoad()}`);
        this.getUserData(user);
      });
    } catch (e) {
      throw e;
    }
  },

  /*
  * get individual user data
  * --> get user picks for gameweek
  * --> get user scores
  * --> get user transfers
  */
  async getUserData(user) {
    try {
      const id = user.entry;
      // console.log(`Getting picks for ${user.player_name}${timeToLoad()}`);
      const { picks, captain, useViceCaptain, chip, pointsHit, subsOut } = await this.userPicks(id);
      user.picks = picks;
      user.captain = captain;
      user.chip = chip;
      user.pointsHit = pointsHit;
      user.subsOut = subsOut;
      user.liveWeekTotal = this.userLiveScores(user);

      // console.log(`Getting scores for ${user.player_name}${timeToLoad()}`);
      const { phaseScores, totalTransfers } = await this.userScores(user);
      const tableEntries = phaseScores.map(score => ({ name: user.player_name, score }));
      tableEntries.forEach((entry, index) => {
        staticData.phases[index].table.entries.push(entry);
      });
      user.phaseScores = phaseScores;
      // console.log(`Getting transfers for ${user.player_name}${timeToLoad()}`);
      user.gameweekTransfers = await this.userTransfers(id);
      user.formation = this.getFormation(picks);
    } catch (e) {
      throw e;
    }
  },

  async userPicks(id) {
    try {
      // eslint-disable-next-line camelcase
      const { active_chip, entry_history, picks } = (await request(
        `entry/${id}/event/${staticData.currentGw.id}/picks`
      )).data;
      // eslint-disable-next-line camelcase
      const pointsHit = entry_history.event_transfers_cost * -1;
      let captain;
      let useViceCaptain = false;
      // eslint-disable-next-line camelcase
      const chip = active_chip;
      const multiplier = chip === '3xc' ? 3 : 2;
      const subsOut = [];
      picks.forEach(footballer => {
        footballer.name = staticData.footballers[footballer.element].web_name;
        footballer.image = imageUrl(staticData.footballers[footballer.element].code);
        footballer.playingPosition = staticData.footballers[footballer.element].element_type;
        footballer.didNotPlay = staticData.footballers[footballer.element].didNotPlay;
        if (footballer.didNotPlay && footballer.position < 11 && subsOut.length < 4) {
          subsOut.push(footballer);
        }
        footballer.liveScore = staticData.footballers[footballer.element].liveScore;
        if (footballer.is_captain) {
          captain = footballer.name;
          if (footballer.didNotPlay) {
            useViceCaptain = true;
          } else if (typeof footballer.liveScore === 'number') {
            footballer.liveScore *= multiplier;
          }
        }
        if (useViceCaptain && footballer.is_vice_captain && typeof footballer.liveScore === 'number') {
          footballer.liveScore *= multiplier;
        }
      });
      picks.sort((a, b) => a.position - b.position);

      return {
        picks,
        captain,
        useViceCaptain,
        chip,
        pointsHit,
        subsOut
      };
    } catch (e) {
      throw e;
    }
  },

  async userScores(user) {
    const { history, entry } = (await request(`entry/${user.entry}/history`)).data;
    const totalTransfers = entry.total_transfers;
    const gameweekScores = [];
    for (let i = 0; i < history.length; i += 1) {
      const netScore = history[i].points - history[i].event_transfers_cost;
      gameweekScores.push(netScore);
    }

    for (let i = history.length; i < staticData.currentGw.id; i += 1) {
      gameweekScores.unshift(0);
    }

    const netScore = user.liveWeekTotal + user.pointsHit;

    if (gameweekScores.length === staticData.currentGw.id) {
      gameweekScores[staticData.currentGw.id - 1] = netScore;
    } else {
      gameweekScores.push(netScore);
    }

    const phaseScores = [];
    staticData.phases.forEach(phase => {
      const start = phase.start_event - 1;
      const end = phase.stop_event;
      const scores = gameweekScores.slice(start, end);
      if (scores.length > 0) {
        const score = scores.reduce((tot, val) => tot + val);
        phaseScores.push(score);
      }
    });

    return { phaseScores, totalTransfers };
  },

  async userTransfers(id) {
    const { history } = (await request(`entry/${id}/transfers`)).data;
    const gameweekTransfers = history.filter(transfer => transfer.event === staticData.currentGw.id);
    gameweekTransfers.forEach(transfer => {
      transfer.playerIn = staticData.footballers[transfer.element_in].web_name;
      transfer.playerOut = staticData.footballers[transfer.element_out].web_name;
    });
    return gameweekTransfers;
  },

  getFormation(team) {
    let gk = 0;
    let df = 0;
    let mf = 0;
    let fw = 0;
    let j = 0;
    while (team[j].playingPosition === 1) {
      gk += 1;
      j += 1;
    }

    while (team[j].playingPosition === 2) {
      df += 1;
      j += 1;
    }

    while (team[j].playingPosition === 3) {
      mf += 1;
      j += 1;
    }

    while (team[j].playingPosition === 4) {
      fw += 1;
      j += 1;
    }

    return {
      g: gk,
      d: df,
      m: mf,
      f: fw
    };
  },

  // DNP gk
  // DNP 0
  // DNP 1
  // DNP 2
  // DNP >= 3
  // bboost

  userLiveScores(user) {
    const { picks } = user;
    const scorers = picks.filter(pick => typeof pick.liveScore === 'number' && pick.position <= 11);
    const scores = scorers.map(scorer => scorer.liveScore);
    console.log(scores);
    const score = scores.reduce((tot, val) => tot + val);
    console.log(score);
    const formation = this.getFormation(picks);
    console.log(formation);
    console.log(user.subsOut);
    return score;

    function validFormation() {
      const eleven = formation.g + formation.d + formation.m + formation.f === 11;
      const positions = formation.g === 1 && formation.d >= 3 && formation.f >= 1;
      return eleven && positions;
    }

    function checkSub(footballerOut, footballerIn) {
      switch (footballerOut.playingPosition) {
        case 1:
          formation.g -= 1;
          break;
        case 2:
          formation.d -= 1;
          break;
        case 3:
          formation.m -= 1;
          break;
        case 4:
          formation.f -= 1;
          break;
        default:
          break;
      }

      switch (footballerIn.playingPosition) {
        case 1:
          formation.g += 1;
          break;
        case 2:
          formation.d += 1;
          break;
        case 3:
          formation.m += 1;
          break;
        case 4:
          formation.f += 1;
          break;
        default:
          break;
      }
      return validFormation();
    }

    if (footballer.liveScore) {
      footballer.liveScore *= footballer.multiplier;
      if (user.team.indexOf(footballer) < 11 || user.transferDetails.chip === 'bboost') {
        user.liveWeekTotal += footballer.liveScore;
      }
    }

    if (user.transferDetails.chip !== 'bboost') {
      if (footballer.didNotPlay) {
        footballer.didNotPlay = true;
        footballer.liveScore = '-';
        if (user.team.indexOf(footballer) < 11) {
          footballer.subOut = true;
          user.subsOut.push(footballer);
        }
      }

      if (user.subsOut.length > 0 && user.team.indexOf(footballer) > 10 && !footballer.didNotPlay) {
        for (let i = 0; i < user.subsOut.length; i += 1) {
          if (checkSub(user.subsOut[i], footballer)) {
            footballer.subIn = true;
            if (footballer.liveScore) {
              player.liveWeekTotal += footballer.liveScore;
            }
            player.subsOut.splice(i, 1);
          }
        }
      }
    }
  },

  getStats(footballersArray) {
    let timeout = 0;
    let delay = footballersArray.length;
    footballersArray.forEach((footballer, index, array) => {
      setTimeout(() => {
        request(`element-summary/${footballer.id}`)
          .then(response => {
            const body = response.data;
            let total = 0;
            const power = 1 - 1 + gameDetails.thisGameWeek / 10;
            for (let i = 1; i <= gameDetails.thisGameWeek; i += 1) {
              total += i ** power;
            }

            footballer.weightedCreativity = 0;
            footballer.weightedThreat = 0;
            body.history.forEach(event => {
              footballer.weightedCreativity += (Number(event.creativity) * event.round ** power) / total;
              footballer.weightedThreat += (Number(event.threat) * event.round ** power) / total;
            });
            // logger.debug('got stats for ' + footballer.web_name + timeToLoad());
            footballer.rating =
              footballer.weightedThreat * (8 - footballer.element_type) + footballer.weightedCreativity * 3; // (footballer.now_cost/10);
            delay -= 1;
            if (delay === 0) {
              array.sort((a, b) => b.rating - a.rating);
              array.forEach(player => {
                let position = '';
                switch (player.element_type) {
                  case 1:
                    position = '\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tGK';
                    break;
                  case 2:
                    position = '\t\t\t\t\t\t\t\t\t\t\t\tDF';
                    break;
                  case 3:
                    position = '\t\t\t\t\t\tMF';
                    break;
                  case 4:
                    position = 'FW';
                    break;
                  default:
                    break;
                }
                if (player.element_type === 3 && player.now_cost < 49) {
                  console.log(position, player.web_name, Math.round(player.rating) / 10);
                }
              });
            }
          })
          .catch(err => {
            console.error(`error retrieving stats for ${footballer.web_name}\n${err}`);
          });
      }, timeout);
      timeout += 30;
    });
  },

  getLiveScores(player, footballer) {
    const formation = this.getFormation(player.team);

    function validFormation() {
      const eleven = formation.g + formation.d + formation.m + formation.f === 11;
      const positions = formation.g === 1 && formation.d >= 3 && formation.f >= 1;
      return eleven && positions;
    }

    function checkSub(footballerOut, footballerIn) {
      switch (footballerOut.playingPosition) {
        case 1:
          formation.g -= 1;
          break;
        case 2:
          formation.d -= 1;
          break;
        case 3:
          formation.m -= 1;
          break;
        case 4:
          formation.f -= 1;
          break;
        default:
          break;
      }

      switch (footballerIn.playingPosition) {
        case 1:
          formation.g += 1;
          break;
        case 2:
          formation.d += 1;
          break;
        case 3:
          formation.m += 1;
          break;
        case 4:
          formation.f += 1;
          break;
        default:
          break;
      }
      return validFormation();
    }

    if (footballer.liveScore) {
      footballer.liveScore *= footballer.multiplier;
      if (player.team.indexOf(footballer) < 11 || player.transferDetails.chip === 'bboost') {
        player.liveWeekTotal += footballer.liveScore;
      }
    }

    if (player.transferDetails.chip !== 'bboost') {
      if (footballer.didNotPlay) {
        footballer.didNotPlay = true;
        footballer.liveScore = '-';
        if (player.team.indexOf(footballer) < 11) {
          footballer.subOut = true;
          player.subsOut.push(footballer);
        }
      }

      if (player.subsOut.length > 0 && player.team.indexOf(footballer) > 10 && !footballer.didNotPlay) {
        for (let i = 0; i < player.subsOut.length; i += 1) {
          if (checkSub(player.subsOut[i], footballer)) {
            footballer.subIn = true;
            if (footballer.liveScore) {
              player.liveWeekTotal += footballer.liveScore;
            }
            player.subsOut.splice(i, 1);
          }
        }
      }
    }

    player.weekScores[gameDetails.thisGameWeek].points = player.liveWeekTotal;
    player.weekScores[gameDetails.thisGameWeek].netScore =
      player.liveWeekTotal - player.weekScores[gameDetails.thisGameWeek].event_transfers_cost;

    console.log(`Live scores retrieved for ${player.player_name} (${footballer.position}/15)${timeToLoad()}`);

    this.getMonthScores(player);
    liveScoreCounter += 1;
    if (liveScoreCounter === Object.keys(players).length * 15) {
      tables = [];
      this.createTables();
      this.overallTable();
    }
  },

  index(req, response) {
    const tables = staticData.phases.map(phase => phase.table).filter(table => table.entries.length > 0);
    tables.forEach((table, index) => {
      table.entries.sort((a, b) => b.score - a.score);
      if (index === 0) {
        table.entries[0].prize = 220;
        table.entries[1].prize = 100;
        table.entries[2].prize = 50;
      } else if (index === 1 || index === 11) {
        table.entries[0].prize = 10;
      } else {
        table.entries[0].prize = 20;
      }
    });
    const viewData = {
      title: 'Fantasy Football',
      players: users,
      tables,
      loading
    };

    response.render('index', viewData);
  }
};

module.exports = fpl;
