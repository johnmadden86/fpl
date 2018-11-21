/** @format */

const axios = require('axios');
const axiosRetry = require('axios-retry');
const singleLineLog = require('log-update');

// eslint-disable-next-line no-unused-vars
const Handlebars = require('../utils/handlebar-helper');

const leagueCode = 484626;

let time = new Date();

const timeToLoad = () => {
  let ttl = new Date() - time;
  ttl /= 1000;
  return ` in ${ttl} secs`;
};

const imageUrl = code =>
  `https://platform-static-files.s3.amazonaws.com/premierleague/photos/players/110x140/p${code}.png`;

const sumArray = array => (array.length === 0 ? 0 : array.reduce((tot, val) => tot + val));

const meanArray = array => {
  if (array.length === 0) {
    return 0;
  }
  return array.reduce((tot, val, index, arr) => {
    let r = tot;
    r += val;

    if (index === arr.length - 1) {
      return r / arr.length;
    }
    return r;
  });
};

let loading;

const req = async url => {
  const fplRequest = axios.create({
    baseURL: 'https://fantasy.premierleague.com/drf/',
    method: 'GET'
  });
  axiosRetry(fplRequest, { retries: 10 /* , retryDelay: axiosRetry.exponentialDelay */ });
  return (await fplRequest(url)).data;
};

const staticData = { phases: [] };
const leagueData = { users: [], tables: [] };

// const arrToObj = arr => arr.reduce((obj, elem) => ({ ...obj, [elem.id]: elem }), {});

const fpl = {
  async runApp() {
    const liveUpdate = async () => {
      const fixtureKickOffTimes = await fpl.liveFootballerScores(staticData.footballers);
      console.log(`Live scores gathered for ${staticData.footballers.length} footballers${timeToLoad()}`);
      return fixtureKickOffTimes;
    };
    const weekly = async () => {
      loading = true;
      const tasks = [];
      time = new Date();
      tasks.push(Object.assign(staticData, await fpl.getStaticData()));
      // eslint-disable-next-line camelcase
      const { deadline_time_epoch, deadline_time_game_offset } = staticData.nextGw;
      // eslint-disable-next-line camelcase
      const nextUpdate = new Date((deadline_time_epoch - deadline_time_game_offset + 60 * 30) * 1000);
      tasks.push(Object.assign(staticData, { footballers: await fpl.getFootballers() }));
      const fixtureKickOffTimes = [];
      tasks.push(Object.assign(fixtureKickOffTimes, await liveUpdate()));
      tasks.push(Object.assign(leagueData.users, await fpl.getLeagueData(leagueCode)));
      await Promise.all(tasks);
      const fixtureTimes = fixtureKickOffTimes.map(f =>
        Object.assign({ kickoff: f, finish: new Date(Date.parse(f) + 1000 * 60 * 60 * 2) })
      );

      return { fixtureTimes, nextUpdate };
    };
    const run = async details => {
      const { fixtureTimes, nextUpdate } = details;
      const t = new Date();
      let inProgress = false;
      for (const f of fixtureTimes) {
        if (f.kickoff > t && t < f.finish) {
          inProgress = true;
          break;
        }
      }
      const adjustment = t.getSeconds() % 5;
      if (t.getMinutes() % 5 === 0 && t.getSeconds() === 0 && inProgress) {
        console.log('Getting live update');
        await liveUpdate();
        for (const user of leagueData.users) {
          // repeated in get user data
          Object.assign(user, { liveWeekTotal: this.userLiveScores(user) });
          Object.assign(user, this.userScores(user));
          Object.assign(leagueData.tables, this.tableSort());
        }
      }
      if (t > nextUpdate) {
        Object.assign(details, await weekly());
      }
      const timeout = (5 - adjustment) * 1000;
      setTimeout(run, timeout, details);
    };
    try {
      const details = await weekly();
      await run(details);
    } catch (e) {
      throw e;
    }
  },

  /*
   * Retrieve and assemble the game's "static" data
   */
  async getStaticData() {
    try {
      const events = await req('events');
      console.log(`${events.length} events loaded in${timeToLoad()}`);
      const currentGw = events.find(e => e.is_current === true);
      const nextGw = events.find(e => e.is_next === true);
      console.log(`Current Gameweek: ${currentGw.id}, Next Gameweek: ${nextGw.id}`);
      const fixtures = await req('fixtures');
      console.log(`${fixtures.length} fixtures loaded in${timeToLoad()}`);
      const phases = await req('phases');
      console.log(`${phases.length} phases loaded in${timeToLoad()}`);
      for (const phase of phases) {
        phase.table = { name: phase.name, entries: [] };
      }
      // teams = (await request('teams')).data;
      return { events, currentGw, nextGw, phases, fixtures };
    } catch (e) {
      throw e;
    }
  },

  async getFootballers() {
    try {
      const footballers = await req('elements');
      footballers.map(footballer => Object.assign(footballer, { image: imageUrl(footballer.code) }));
      console.log(`${Object.keys(footballers).length} footballers loaded in${timeToLoad()}`);

      let i = 1;
      const activeFootballers = footballers.filter(f => f.minutes > 0 && f.element_type > 1);
      const maxNameLength = Math.max(...activeFootballers.map(f => f.web_name.length));

      let timeout = 0;
      const getRating = async footballer => {
        const rating = await this.getStats(footballer);
        singleLineLog(
          `Stats gathered for ${footballer.web_name.padEnd(maxNameLength)} ${i}/${
            activeFootballers.length
          } ${timeToLoad()}`
        );
        Object.assign(footballer, { rating });
        if (i === activeFootballers.length) {
          singleLineLog.clear();
          console.log(
            `Stats for ${activeFootballers.filter(p => p.rating).length} footballers gathered${timeToLoad()}`
          );
        }
        i += 1;
      };
      const tasks = [];
      for (const footballer of activeFootballers) {
        tasks.push(setTimeout(getRating, timeout, footballer));
        timeout += 100;
      }
      await Promise.all(tasks);
      return footballers;
    } catch (e) {
      throw e;
    }
  },

  async getStats(footballer) {
    try {
      const games = (await req(`element-summary/${footballer.id}`)).history;
      const pointsPerGoal = footballer.element_type <= 2 ? 6 : 8 - footballer.element_type;
      const top6 = [1, 6, 12, 13, 14, 17];
      for (const game of games) {
        const p = 1 + game.round / 10;
        game.formWeight = p ** p;
        game.attackRating = game.threat * pointsPerGoal + game.creativity * 3;
      }

      const gamesPlayedIn = games.filter(game => game.minutes > 0);
      const homeGames = gamesPlayedIn.filter(game => game.was_home && !top6.includes(game.opponent_team));
      const awayGames = gamesPlayedIn.filter(game => !game.was_home && !top6.includes(game.opponent_team));
      const top6Games = gamesPlayedIn.filter(game => top6.includes(game.opponent_team));
      // const bottom14Games = gamesPlayedIn.filter(game => !top6.includes(game.opponent_team));

      const attackRatings = gamesPlayedIn.map(game => game.attackRating);
      const attackRatingsWeighted = games.map(game => game.attackRating * game.formWeight);

      const homeAttackRatings = homeGames.map(game => game.attackRating * game.formWeight);
      const awayAttackRatings = awayGames.map(game => game.attackRating * game.formWeight);
      const top6AttackRatings = top6Games.map(game => game.attackRating * game.formWeight);
      // const bottom14AttackRatings = bottom14Games.map(game => game.attackRating);
      const formWeights = games.map(game => game.formWeight);
      const formWeightsH = homeGames.map(game => game.formWeight);
      const formWeightsA = awayGames.map(game => game.formWeight);
      const formWeights6 = top6Games.map(game => game.formWeight);

      const total = Math.round(sumArray(attackRatings));
      const form = Math.round(sumArray(attackRatingsWeighted) / sumArray(formWeights));

      const perHomeGame = Math.round(sumArray(homeAttackRatings) / sumArray(formWeightsH));
      const perAwayGame = Math.round(sumArray(awayAttackRatings) / sumArray(formWeightsA)); // perHomeGame);
      const perTop6Game = Math.round(sumArray(top6AttackRatings) / sumArray(formWeights6)); // perHomeGame);

      return {
        total,
        perGame: Math.round(meanArray(attackRatings)),
        per90mins: footballer.minutes === 0 ? 0 : Math.round((90 * total) / footballer.minutes),
        perHomeGame,
        perAwayGame,
        perTop6Game,
        // perBottom14Game: Math.round(meanArray(bottom14AttackRatings)),
        form,
        value: Math.round(form / (footballer.now_cost / 100)) / 10
      };
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
      const { elements, fixtures } = await req(`event/${staticData.currentGw.id}/live`);
      const fixtureKickOffTimes = fixtures.map(f => new Date(f.kickoff_time));
      for (const footballer of footballers) {
        const { explain, stats } = elements[footballer.id];
        const fixtureId = explain[0][1];
        const details = explain[0][0];
        const minutes = details.minutes.value;
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (fixture.started) {
          footballer.didNotPlay = minutes === 0;
          footballer.liveScore = stats.total_points;
        }
      }

      for (const fixture of fixtures) {
        let bonusApplied = fixture.stats[8];
        if (bonusApplied) {
          bonusApplied = fixture.stats[8].bonus.a.length + fixture.stats[8].bonus.h.length > 0;
        }
        if (!bonusApplied && fixture.started) {
          const bonus = this.getBonus(fixture);
          this.applyBonus(footballers, bonus);
        }
      }

      return fixtureKickOffTimes;
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

      while (threeBonusCount === 1 && bps[1].value === bps[i].value) {
        twoBonusCount += 1;
        i += 1;
      }

      while (threeBonusCount + twoBonusCount === 2 && bps[2].value === bps[i].value) {
        oneBonusCount += 1;
        i += 1;
      }

      let j = 0;
      while (j < threeBonusCount) {
        three.push(bps[j].element);
        j += 1;
      }
      while (j < threeBonusCount + twoBonusCount) {
        two.push(bps[j].element);
        j += 1;
      }
      while (j < threeBonusCount + twoBonusCount + oneBonusCount) {
        one.push(bps[j].element);
        j += 1;
      }
    }

    return [one, two, three];
  },

  /*
   * Adds bonus points to footballer's live total
   */
  applyBonus(footballers, bonus) {
    function apply(arr, points) {
      for (const element of arr) {
        const footballer = footballers.find(f => f.id === element);
        footballer.liveScore += points;
      }
    }

    for (let i = 0; i < bonus.length; i += 1) {
      apply(bonus[i], i + 1);
    }
  },

  /*
   * Get user data for league
   * --> get user data
   */
  async getLeagueData(leagueId) {
    try {
      const users = (await req(`leagues-classic-standings/${leagueId}`)).standings.results;
      const maxNameLength = Math.max(...users.map(u => u.player_name.length));
      let i = 1;
      let timeout = 0;
      const getUserDetails = async user => {
        const tableEntries = await this.getUserData(user);
        for (const [index, value] of tableEntries.entries()) {
          // console.log(index, value);
          staticData.phases[index].table.entries.push(value);
        }
        singleLineLog(
          `Data gathered for ${user.player_name.padEnd(maxNameLength)} ${i}/${users.length}${timeToLoad()}`
        );
        if (i === users.length) {
          singleLineLog.clear();
          console.log(`${users.length} users retrieved${timeToLoad()}`);
          Object.assign(leagueData.tables, this.tableSort());
          loading = false;
        }
        i += 1;
      };

      const tasks = [];
      for (const user of users) {
        tasks.push(setTimeout(getUserDetails, timeout, user));
        timeout += 1000;
      }
      await Promise.all(tasks);
      return await users;
    } catch (e) {
      throw e;
    }
  },

  /*
   * get individual user data
   *
   * picks for gameweek
   * transfers
   * formation
   * live gameweek score
   * past gameweek scores
   * scores
   */
  async getUserData(user) {
    try {
      const id = user.entry;
      Object.assign(user, await this.userPicks(id), { gameweekTransfers: await this.userTransfers(id) });
      Object.assign(user, { formation: this.getFormation(user.picks) });

      Object.assign(user, { liveWeekTotal: this.userLiveScores(user) }); // repeated for live update

      Object.assign(user, await req(`entry/${user.entry}/history`));
      Object.assign(user, this.pastUserScores(user));

      Object.assign(user, this.userScores(user)); // repeated for live update
      return user.phaseScores.map(score => ({ name: user.player_name, score }));
    } catch (e) {
      throw e;
    }
  },

  tableSort() {
    const tables = staticData.phases.map(phase => phase.table).filter(table => table.entries.length > 0);

    for (const [index, table] of tables.entries()) {
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
    }
    return tables;
  },

  /*
   * get user gameweek picks
   */
  async userPicks(id) {
    try {
      // eslint-disable-next-line camelcase
      const { active_chip, entry_history, picks } = await req(`entry/${id}/event/${staticData.currentGw.id}/picks`);
      // eslint-disable-next-line camelcase
      const pointsHit = entry_history.event_transfers_cost * -1;
      let captain;
      let useViceCaptain = false;
      let viceCaptainScore;
      // eslint-disable-next-line camelcase
      const chip = active_chip;
      const subsOut = [];
      for (const pick of picks) {
        const footballer = staticData.footballers.find(f => f.id === pick.element);
        Object.assign(pick, footballer);
        if (pick.didNotPlay && pick.position < 11) {
          subsOut.push(pick);
        }
        pick.liveScore *= pick.multiplier;
        if (pick.is_captain) {
          captain = pick.web_name;
          if (pick.didNotPlay) {
            useViceCaptain = true;
          }
        }
        if (pick.is_vice_captain) {
          viceCaptainScore = pick.liveScore;
        }
      }
      picks.sort((a, b) => a.position - b.position);
      return {
        picks,
        captain,
        useViceCaptain,
        viceCaptainScore,
        chip,
        pointsHit,
        subsOut
      };
    } catch (e) {
      throw e;
    }
  },

  pastUserScores(user) {
    const totalTransfers = user.entry.total_transfers;
    const gameweekScores = [];
    for (let i = 0; i < user.history.length; i += 1) {
      const netScore = user.history[i].points - user.history[i].event_transfers_cost;
      gameweekScores.push(netScore);
    }

    for (let i = user.history.length; i < staticData.currentGw.id; i += 1) {
      gameweekScores.unshift(0);
    }
    return { gameweekScores, totalTransfers };
  },

  /*
   * get user phase scores
   */
  userScores(user) {
    const { gameweekScores } = user;

    // live
    const netScoreThisWeek = user.liveWeekTotal + user.pointsHit;

    if (gameweekScores.length === staticData.currentGw.id) {
      gameweekScores[staticData.currentGw.id - 1] = netScoreThisWeek;
    } else {
      gameweekScores.push(netScoreThisWeek);
    }
    //

    const phaseScores = [];
    for (const phase of staticData.phases) {
      const start = phase.start_event - 1;
      const end = phase.stop_event;
      const scores = gameweekScores.slice(start, end);
      if (scores.length > 0) {
        const score = scores.reduce((tot, val) => tot + val);
        phaseScores.push(score);
      }
    }

    return { phaseScores };
  },

  /*
   * get user transfers
   */
  async userTransfers(id) {
    const { history } = await req(`entry/${id}/transfers`);
    const gameweekTransfers = history.filter(transfer => transfer.event === staticData.currentGw.id);
    for (const transfer of gameweekTransfers) {
      transfer.playerIn = staticData.footballers.find(f => f.id === transfer.element_in).web_name;
      transfer.playerOut = staticData.footballers.find(f => f.id === transfer.element_out).web_name;
    }
    return gameweekTransfers;
  },

  /*
   * get formation
   * */
  getFormation(squad) {
    const team = squad.slice(0, 11);
    const gk = team.filter(player => player.element_type === 1).length;
    const df = team.filter(player => player.element_type === 2).length;
    const mf = team.filter(player => player.element_type === 3).length;
    const fw = team.filter(player => player.element_type === 4).length;
    return { g: gk, d: df, m: mf, f: fw };
  },

  /* get live gameweek scores */
  userLiveScores(user) {
    const validFormation = formation => {
      const eleven = formation.g + formation.d + formation.m + formation.f === 11;
      const positions = formation.g === 1 && formation.d >= 3 && formation.f >= 1;
      return eleven && positions;
    };
    const swap = (arr, i, j) => {
      [arr[i], arr[j]] = [arr[j], arr[i]];
    };

    const { picks, subsOut, chip, useViceCaptain, viceCaptainScore } = user;
    if (chip === 'bboost') {
      return sumArray(picks.map(p => p.liveScore));
    }
    const squad = Object.assign([], picks);
    const subsIn = squad.slice(11);

    const markSubs = (subOut, subIn) => {
      picks.find(p => p.element === subOut.element).subOut = true;
      picks.find(p => p.element === subIn.element).subIn = true;
    };

    for (const subOut of subsOut) {
      let i = 0;
      while (i < subsIn.length) {
        if (!subsIn[i].didNotPlay) {
          swap(squad, subOut.position - 1, subsIn[i].position - 1);
          if (validFormation(this.getFormation(squad))) {
            console.log(`Out: ${subOut.web_name}`, `In: ${subsIn[i].web_name}`);
            markSubs(subOut, subsIn);
            subsIn.splice(i, 1);
            break;
          }
          swap(squad, subsIn[i].position - 1, subOut.position - 1);
        }
        i += 1;
      }
    }

    const scorers = squad.slice(0, 11);
    const scores = scorers.map(scorer => scorer.liveScore);
    let score = sumArray(scores);
    if (useViceCaptain) {
      score += viceCaptainScore;
      if (chip === '3xc') {
        score += viceCaptainScore;
      }
    }
    return score;
  },

  index(r, response) {
    const { users, tables } = leagueData;
    const data = {
      title: 'Fantasy Football',
      players: users,
      tables,
      loading
    };

    response.render('index', data);
  },

  stats(r, response) {
    const data = {
      title: 'Stats',
      footballers: Object.values(staticData.footballers).filter(f => f.rating)
    };
    data.footballers.sort((a, b) => b.rating.value - a.rating.value);
    response.render('stats', data);
  }
};

module.exports = fpl;
