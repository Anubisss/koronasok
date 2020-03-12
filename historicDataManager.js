'use strict';

const winston = require('winston');

class HistoricDataManager {
  s3Client;
  hostS3BucketName;
  fileName;

  constructor(s3Client, hostS3BucketName, fileName) {
    this.s3Client = s3Client;
    this.hostS3BucketName = hostS3BucketName;
    this.fileName = fileName;
  }

  async handle(date, infected, recovered, died) {
    winston.info(`HistoricDataManager::handle date: ${date}, infected: ${infected}, recovered: ${recovered}, died: ${died}`);

    let data;
    if (await this.doesDataFileExist()) {
      const stringData = await this.readDataFileFromS3();
      data = JSON.parse(stringData.Body);
    }

    let needToSave = false;
    if (data) {
      if (this.needToAppendData(data, infected, recovered, died)) {
        this.appendData(data, date, infected, recovered, died);
        needToSave = true;
      }
    } else {
      data = this.createData(date, infected, recovered, died);
      needToSave = true;
    }

    if (needToSave) {
      await this.saveDataFileToS3(data);
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
    winston.info(`HistoricDataManager::needToAppendData infected: ${infected}, recovered: ${recovered}, died: ${died}`);

    const lastDataEntry = data[data.length - 1];
    winston.info(
      `HistoricDataManager::needToAppendData last data entry infected: ${lastDataEntry.infected}, ` +
      `recovered: ${lastDataEntry.recovered}, died: ${lastDataEntry.died}`
    );

    return lastDataEntry.infected !== infected || lastDataEntry.recovered !== recovered || lastDataEntry.died !== died;
  }

  appendData(data, date, infected, recovered, died) {
    winston.info(`HistoricDataManager::appendData date: ${date}, infected: ${infected}, recovered: ${recovered}, died: ${died}`);

    data.push({
      date,
      infected,
      recovered,
      died,
    });
  }

  createData(date, infected, recovered, died) {
    winston.info(`HistoricDataManager::createData date: ${date}, infected: ${infected}, recovered: ${recovered}, died: ${died}`);

    return [
      {
        date,
        infected,
        recovered,
        died,
      },
    ];
  }
}

module.exports = HistoricDataManager;
