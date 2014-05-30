#!/usr/bin/env node

document = ''; // cheap hack
var telem = require('./telemetry');

var nodemailer = require("nodemailer");
var zlib = require('zlib');
var url = require('url');
var http = require('https');

// Overwrite the native telemetry.js library
telem.Telemetry.getUrl = function(path, cb) {
  http.get(path, function(res) {
    var chunks = [];
    res.on('data', function(chunk) {
      chunks.push(chunk);
    });

    res.on('end', function() {
      body = Buffer.concat(chunks);
      var encoding = res.headers['content-encoding'];
      zlib.gunzip(body, function(err, decoded) {
        if (err) {
          cb(err, null)
        } else {
          cb(null, JSON.parse(decoded.toString()));
        }
      });
    });
  }).on('error', function(e) {
    console.log("Got error: ", e);
  });
}

var changeVersion = function(version) {
  var type = version.split('/')[0];
  var num = version.split('/')[1];
  // determine if should jump to earlier nightly
  // or down from aurora to nightly...
  if (type == 'nightly'){
    num--;
  } else {
    if (type == 'release'){
      type = 'aurora';
    } else if (type == 'aurora'){
      type = 'beta';
    } else if (type == 'beta') {
      type = 'nightly'
    }
  }
  version = type + '/' + num;
  return version;
}

var getMostRecentDay = function(measure, version, cb) {

  for(i = 0; i < 1 ; i++){
    var dayCount = function(){
      return function(){
        var histo = function(version, setVersion){
          return function(histogramEvolution) {
            var date = new Date();
            while (true) {
              var histo = histogramEvolution.range(date, date);
              var sum = 0;
              var divisor = 0;
              histo.map(function(count, start, end, index) {
                sum = sum + (count * start);
                divisor = divisor + count;
              });
              // check if the branch needs to be changed
              if (divisor == 0 && sum == 0) {
                //console.log('no data on ' + date);
                var extendedHisto = histogramEvolution.range(null, date);
                if (extendedHisto.submissions() == 0){
                  //         console.log('change ver');
                  setVersion(changeVersion(version));
                } else {
                  date.setDate(date.getDate()-1);
                }
              } else {
                cb(date, (sum/divisor));
                break;
              }
            }
          }
        }
        var setVersion = function(version) {
          // console.log('no more in this range! drop back to ' + version);
          telem.Telemetry.loadEvolutionOverTime(version, measure, histo(version, setVersion));
        }
        telem.Telemetry.loadEvolutionOverTime(version, measure, histo(version, setVersion));
      }
    }
    telem.Telemetry.init(dayCount());
  }
};

var getStats = function(measure, startDay, nDays, version, cb) {
  if (!(startDay)) {
    startDay = new Date();
  }

  points = [];
  var addDataSet = function(point) {
    points.push(point);
  }

  var cnt = 0;
  var cbCheck = function() {
    cnt++;
    if (cnt == nDays){
      cb(points)
    }
  }

  for(i = 0; i < nDays ; i++){
    var dayCount = function(x){
      return function(){
        var date = new Date(startDay - x*24*60*60*1000);
        var histo = function(version, setVersion){
          return function(histogramEvolution) {
            var histo = histogramEvolution.range(date, date);
            var sum = 0;
            var divisor = 0;
            histo.map(function(count, start, end, index) {
              sum = sum + (count * start);
              divisor = divisor + count;
            });
            // check if the branch needs to be changed
            if (divisor == 0 && sum == 0) {
              console.log('no data on ' + date);
              var extendedHisto = histogramEvolution.range(null, date);
              if (extendedHisto.submissions() == 0){
                setVersion(changeVersion(version));
              }  else {
                cbCheck();
              }
            } else {
              addDataSet(sum/divisor);
              cbCheck();
            }
          }
        }
        var setVersion = function(version) {
          // console.log('no more in this range! drop back to ' + version);
          telem.Telemetry.loadEvolutionOverTime(version, measure, histo(version, setVersion));
        }
        telem.Telemetry.loadEvolutionOverTime(version, measure, histo(version, setVersion));
      }
    }
    telem.Telemetry.init(dayCount(i));
  }
}

function checkValidMeasure(measure){
  // TODO check the possible measures
  return true; //(measure == 'WEBRTC_ICE_SUCCESS_RATE');
}

function checkValidDays(days){
  return (typeof days === 'number');
}

function checkValidBranch(version){
  var type = version.split('/')[0];
  var num = parseInt(version.split('/')[1]);
  if (!(type == 'nightly' || type == 'aurora' || type == 'beta')){
    return false;
  }
  if (!(typeof num === 'number')){
    return false;
  }
  return true;
}

var sampleMean = function(data) {
  var total = data.reduce(function(a, b) {
    return a + b;
  });
  mean = total/data.length;
  return mean;
};

var stdDev = function(data) {
  var mean = sampleMean(data);
  size = data.length;
  var sum = 0;
  for (var i = 0; i < size; i++){
    sum = sum + Math.pow(data[i] - mean, 2);
  }
  stdDev = Math.sqrt(sum/size);
  return stdDev;
}

var tTest = function(sample, data){
  console.log(sample);
  var mean = sampleMean(data);
  console.log('mean: ' + mean);
  var dev = stdDev(data);
  console.log("stdDev: " + dev);
  var t = (mean - sample)/ (dev / Math.sqrt(data.length));
  console.log("t value: " + t);
  return t;
}

var main = function() {
  if (process.argv.length == 5) {
    var measure = process.argv[2];
    var nDays = parseInt(process.argv[3]);
    var branch = process.argv[4];
    //    var stats = process.argv[5];

    // data sanitization
    if (!checkValidMeasure(measure)){
      console.log('Select a valid measurment such as \'WEBRTC_ICE_SUCCESS_RATE\'');
      process.exit(code=0)
    }
    if (!checkValidDays(nDays)){
      console.log('Select an integer which represents the number of days');
      process.exit(code=0)
    }
    if (!checkValidBranch(branch)){
      console.log('Select an actual branch such as \'nightly/32\'');
      process.exit(code=0)
    }
    //    if !checkValidStats(stats){
    //      console.log('Select a stat test');
    //    }

    getMostRecentDay(measure, branch, function(startDay, sample) {
      console.log('Most recent day: ' + startDay);
      getStats(measure, startDay, nDays, branch, function(data) {
        var tVal = tTest(sample, data);
        console.log(tVal);
//    var pVal = tPest(...);
//    if (significant(tVal)){
//      sendAlert(measure, nDays, branch, mostRecentPoint);
      });
    });

  } else {
    console.log('node telem-server.js <measure> <n days to measure>');
    process.exit(code=0);
  }
}

main();
