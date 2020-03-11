'use strict';

const util = require('util');
const winston = require('winston');
const request = require('request-promise');
const parse5 = require('parse5');
const ejs = require('ejs');
const moment = require('moment-timezone');
const AWS = require('aws-sdk');

const HOST_S3_BUCKET_NAME = process.env.HOST_S3_BUCKET_NAME;
const GA_TRACKING_ID = process.env.GA_TRACKING_ID;

const DATA_URL = 'https://koronavirus.gov.hu/';

const TEMPLATE_PATH = './template.ejs';

const logFormatter = (awsRequestId, options) => {
  const { level, message: msg, ...meta } = options;

  return JSON.stringify({
    level,
    msg,
    meta,
    awsRequestId,
  });
};

const getData = async () => {
  winston.info('getData');
  try {
    return await request.get(DATA_URL);
  } catch (err) {
    throw new Error(`got non 200 response, error name: ${err.name}, status code: ${err.statusCode}`);
  }
};

const processData = (data) => {
  winston.info('processData');

  const viewContent = data.childNodes[1].childNodes[2].childNodes[1].childNodes[1].childNodes[1]
    .childNodes[1].childNodes[3].childNodes[1].childNodes[1].childNodes[4].childNodes[0].childNodes[3];
  if (viewContent.nodeName !== 'div' || viewContent.tagName !== 'div' ||
      viewContent.attrs.length !== 1 || viewContent.attrs[0].name !== 'class' || viewContent.attrs[0].value !== 'view-content') {
    throw new Error(`invalid view content properties: nodeName: ${a.nodeName}, tagName: ${a.tagName}, attrs: ${util.inspect(a.attrs)}`);
  }

  const rawInfectedValue = processBlock(viewContent, 1, 'Fertőzött');
  const rawRecoveredValue = processBlock(viewContent, 3, 'Gyógyult');
  const rawDiedValue = processBlock(viewContent, 5, 'Elhunyt');

  const infected = new Number(rawInfectedValue);
  const recovered = new Number(rawRecoveredValue);
  const died = new Number(rawDiedValue);

  if (isNaN(infected) || infected < 0) {
    throw new Error(`invalid infected value, rawInfectedValue: ${rawInfectedValue}, infected: ${infected}`);
  }
  if (isNaN(recovered) || recovered < 0) {
    throw new Error(`invalid recovered value, rawRecoveredValue: ${rawRecoveredValue}, recovered: ${recovered}`);
  }
  if (isNaN(died) || died < 0) {
    throw new Error(`invalid died value, rawDiedValue: ${rawDiedValue}, died: ${died}`);
  }

  return {
    infected,
    recovered,
    died,
  };
};

const processBlock = (viewContent, blockIndex, label) => {
  winston.info(`processBlock blockIndex: ${blockIndex}, label: ${label}`);

  const block = viewContent.childNodes[blockIndex].childNodes[1].childNodes[1].childNodes[0];
  if (block.nodeName !== 'div' || block.tagName !== 'div' ||
      block.attrs.length !== 1 || block.attrs[0].name !== 'class' || block.attrs[0].value !== 'diagram-a') {
    throw new Error(`invalid block properties: nodeName: ${block.nodeName}, tagName: ${block.tagName}, attrs: ${util.inspect(block.attrs)}`);
  }

  const blockSpan = block.childNodes[1];
  if (blockSpan.nodeName !== 'span' || blockSpan.tagName !== 'span' ||
      blockSpan.attrs.length !== 1 || blockSpan.attrs[0].name !== 'class' || blockSpan.attrs[0].value !== 'number') {
    throw new Error(`invalid block span properties: nodeName: ${blockSpan.nodeName}, tagName: ${blockSpan.tagName}, attrs: ${util.inspect(blockSpan.attrs)}`);
  }

  const blockLabel = block.childNodes[3];
  if (blockLabel.nodeName !== 'span' || blockLabel.tagName !== 'span' ||
      blockLabel.attrs.length !== 1 || blockLabel.attrs[0].name !== 'class' || blockLabel.attrs[0].value !== 'label') {
    throw new Error(`invalid block label properties: nodeName: ${blockLabel.nodeName}, tagName: ${blockLabel.tagName}, attrs: ${util.inspect(blockLabel.attrs)}`);
  }

  const blockLabelValue = blockLabel.childNodes[0];
  if (blockLabelValue.nodeName !== '#text' || blockLabelValue.value !== label) {
    throw new Error(`invalid block label value: ${blockLabelValue.value}`);
  }

  const blockValue = blockSpan.childNodes[0];
  if (blockValue.nodeName !== '#text') {
    throw new Error(`invalid block value properties: nodeName: ${blockValue.nodeName}, tagName: ${blockValue.tagName}, attrs: ${util.inspect(blockValue.attrs)}`);
  }

  return blockValue.value;
};

const renderHtml = (infected, recovered, died) => {
  winston.info(`renderHtml infected: ${infected}, recovered: ${recovered}, died: ${died}`);

  const templateData = {
    infected: infected,
    recovered: recovered,
    died: died,
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

const uploadToS3 = (html) => {
  winston.info('uploadToS3');
  return new AWS.S3().putObject({
    Bucket: HOST_S3_BUCKET_NAME,
    Key: 'index.html',
    Body: html,
    ContentType: 'text/html; charset=utf-8',
  }).promise();
};

const handler = async (event, context) => {
  winston.remove(winston.transports.Console);
  winston.add(new winston.transports.Console({
    format: winston.format.printf(logFormatter.bind(null, context.awsRequestId)),
  }));

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
    const data = await getData();
    const parsedData = parse5.parse(data);
    const processedData = processData(parsedData);
    const html = await renderHtml(processedData.infected, processedData.recovered, processedData.died);
    await uploadToS3(html);
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
