'use strict';

const winston = require('winston');
const moment = require('moment-timezone');

class HistoricDataManager {
  s3Client;
  hostS3BucketName;
  fileName;
  data;

  constructor(s3Client, hostS3BucketName, fileName) {
    this.s3Client = s3Client;
    this.hostS3BucketName = hostS3BucketName;
    this.fileName = fileName;
    this.data = null;
  }

  async handle(date, infected, recovered, died) {
    winston.info('HistoricDataManager::handle', { date, infected, recovered, died });

    if (await this.doesDataFileExist()) {
      const stringData = await this.readDataFileFromS3();
      this.data = JSON.parse(stringData.Body);
    }

    let needToSave = false;
    if (this.data) {
      if (this.needToAppendData(this.data, infected, recovered, died)) {
        this.appendData(this.data, date, infected, recovered, died);
        needToSave = true;
      }
    } else {
      this.data = this.createData(date, infected, recovered, died);
      needToSave = true;
    }

    if (needToSave) {
      await this.saveDataFileToS3(this.data);
    }
  }

  async doesDataFileExist() {
    winston.info('HistoricDataManager::doesDataFileExist');

    const params = {
      Bucket: this.hostS3BucketName,
      Key: this.fileName,
    };
    try {
      await this.s3Client.headObject(params).promise();
      return true;
    } catch (err) {
      if (err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
  }

  async readDataFileFromS3() {
    winston.info('HistoricDataManager::readDataFileFromS3');

    const params = {
      Bucket: this.hostS3BucketName,
      Key: this.fileName,
    };
    return await this.s3Client.getObject(params).promise();
  }

  async saveDataFileToS3(data) {
    winston.info('HistoricDataManager::saveDataFileToS3');

    const params = {
      Bucket: this.hostS3BucketName,
      Key: this.fileName,
      Body: JSON.stringify(data),
      ContentType: 'application/json; charset=utf-8',
    };
    await this.s3Client.putObject(params).promise();
  }

  needToAppendData(data, infected, recovered, died) {
    winston.info('HistoricDataManager::needToAppendData', { infected, recovered, died });

    const lastDataEntry = data[data.length - 1];
    winston.info(
      'HistoricDataManager::needToAppendData', {
        lastDataEntry: {
          infected: lastDataEntry.infected,
          recovered: lastDataEntry.recovered,
          died: lastDataEntry.died,
        },
      },
    );

    return lastDataEntry.infected !== infected || lastDataEntry.recovered !== recovered || lastDataEntry.died !== died;
  }

  appendData(data, date, infected, recovered, died) {
    winston.info('HistoricDataManager::appendData', { date, infected, recovered, died });

    data.push({
      date,
      infected,
      recovered,
      died,
    });
  }

  createData(date, infected, recovered, died) {
    winston.info('HistoricDataManager::createData', { date, infected, recovered, died });

    return [
      {
        date,
        infected,
        recovered,
        died,
      },
    ];
  }

  summarizeDataForDay(date) {
    winston.info('HistoricDataManager::summarizeDataForDay', { date });

    const result = {};

    const dataInGivenDateDay = this.data.filter((entry) => {
      const entryDate = moment(entry.date).tz('Europe/Budapest');
      return date.year() === entryDate.year() && date.month() === entryDate.month() && date.day() === entryDate.day();
    });

    if (!dataInGivenDateDay.length) {
      return null;
    }

    const lastDataInDay = dataInGivenDateDay[dataInGivenDateDay.length - 1];

    result.infected = lastDataInDay.infected;
    result.activeInfected = lastDataInDay.infected - lastDataInDay.recovered - lastDataInDay.died;
    result.recovered = lastDataInDay.recovered;
    result.died = lastDataInDay.died;

    return result;
  }
}

module.exports = HistoricDataManager;
