'use strict';

const util = require('util');
const winston = require('winston');
const wjlf = require('winston-json-log-formatter');
const request = require('request-promise');
const jsdom = require('jsdom');
const ejs = require('ejs');
const moment = require('moment-timezone');
const AWS = require('aws-sdk');

const HistoricDataManager = require('./historicDataManager');

const HOST_S3_BUCKET_NAME = process.env.HOST_S3_BUCKET_NAME;
const GA_TRACKING_ID = process.env.GA_TRACKING_ID;

const DATA_URL = 'https://koronavirus.gov.hu/';

const TEMPLATE_PATH = './template.ejs';

const HISTORIC_DATA_FILE_NAME = 'historic-data.json';

const CACHE_TTL = 60;

const REGEX_WHITESPACE = /\s+/g;

const removeWhitespace = (str) => {
  return str.replace(REGEX_WHITESPACE, '');
};

const getData = async () => {
  winston.info('getData');
  try {
    return await request.get(DATA_URL);
  } catch (err) {
    throw new Error(`got non 200 response in get data, error name: ${err.name}, status code: ${err.statusCode}`);
  }
};

const getPestAndCountryData = (document, section) => {
  winston.info('getPestAndCountryData', { section });

  const rawPestValue = removeWhitespace(document.querySelector(`#numbers-API #api-${section}-pest`).textContent);
  const rawCountryValue = removeWhitespace(document.querySelector(`#numbers-API #api-${section}-videk`).textContent);

  const pest = new Number(rawPestValue);
  const country = new Number(rawCountryValue);

  if (isNaN(pest) || pest < 0) {
    throw new Error(`invalid pest value, section: ${section}, rawPestValue: ${rawPestValue}, pest: ${pest}`);
  }
  if (isNaN(country) || country < 0) {
    throw new Error(`invalid country value, section: ${section}, rawCountryValue: ${rawCountryValue}, country: ${country}`);
  }

  return pest + country;
};

const processData = (document) => {
  winston.info('processData');

  const activeInfected = getPestAndCountryData(document, 'fertozott');
  const recovered = getPestAndCountryData(document, 'gyogyult');
  const died = getPestAndCountryData(document, 'elhunyt');

  const infected = activeInfected + recovered + died;

  return {
    infected,
    activeInfected,
    recovered,
    died,
  };
};

const minifyAndRound = (number) => {
  if (number < 1000) {
    return number;
  }

  let roundPrecision = 2;
  if (number > 100000) {
    roundPrecision = 0;
  }
  else if (number > 10000) {
    roundPrecision = 1;
  }

  const minifiedNumber = number / 1000;
  const roundedNumber = +minifiedNumber.toFixed(roundPrecision);
  return roundedNumber + 'k';
};

const renderHtml = (infected, activeInfected, recovered, died) => {
  winston.info('renderHtml', { infected, activeInfected, recovered, died });

  const templateData = {
    infected,
    activeInfected,
    recovered,
    died,
    lastUpdateString: moment().tz('Europe/Budapest').format('YYYY. MM. DD. - HH:mm'),
    gaTrackingId: GA_TRACKING_ID,
  };

  return new Promise((resolve, reject) => {
    ejs.renderFile(TEMPLATE_PATH, templateData, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
};

const uploadToS3 = (s3Client, html) => {
  winston.info('uploadToS3');
  return s3Client.putObject({
    Bucket: HOST_S3_BUCKET_NAME,
    Key: 'index.html',
    Body: html,
    ContentType: 'text/html; charset=utf-8',
    CacheControl: `public, max-age=${CACHE_TTL}`,
  }).promise();
};

const handler = async (event, context) => {
  wjlf.setupTransport(winston, false, { awsRequestId: context.awsRequestId });

  winston.info('starting', {
    nodeEnv: process.env.NODE_ENV,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    timezoneOffset: new Date().getTimezoneOffset() / 60,
    hostS3BucketName: HOST_S3_BUCKET_NAME,
    googleAnalyticsEnabled: GA_TRACKING_ID ? true : false,
  });

  try {
    const s3Client = new AWS.S3();

    const data = await getData();
    const dom = new jsdom.JSDOM(data);
    const processedData = processData(dom.window.document);
    const html = await renderHtml(
      { value: minifyAndRound(processedData.infected), tooltip: processedData.infected },
      { value: minifyAndRound(processedData.activeInfected), tooltip: processedData.activeInfected },
      { value: minifyAndRound(processedData.recovered), tooltip: processedData.recovered },
      { value: minifyAndRound(processedData.died), tooltip: processedData.died },
    );
    await uploadToS3(s3Client, html);

    const historicDataManager = new HistoricDataManager(s3Client, HOST_S3_BUCKET_NAME, HISTORIC_DATA_FILE_NAME);
    await historicDataManager.handle(new Date(), processedData.infected, processedData.recovered, processedData.died);
  } catch (err) {
    winston.error('error occured during page generation', err);
    throw err;
  };

  winston.info('page generated');
  return 'page generated';
};

module.exports = {
  handler,
};
