import zlib from 'zlib';
import AWS from 'aws-sdk';
import each from 'lodash/each';
import constants from './cloud_trail_event_config';
import AutotagFactory from './autotag_factory';
import SETTINGS from "./autotag_settings";

class AwsCloudTrailLogListener {
  constructor(cloudtrailEvent, applicationContext, enabledServices) {
    this.cloudtrailEvent = cloudtrailEvent;
    this.applicationContext = applicationContext;
    this.enabledServices = enabledServices;
    this.s3 = new AWS.S3();
    this.s3Region = '';
  }

  async execute() {
    try {
      this.logDebugS3();
      const logFiles = await this.retrieveLogFileDetails();
      await this.collectAndPerformAutotagActionsFromLogFile(logFiles);

      this.applicationContext.succeed();
    } catch (e) {
      this.handleError(e);
    }
  }

  handleError(err) {
    if (SETTINGS.DebugLoggingOnFailure) {
      console.log("S3 Object Event Failed: " + JSON.stringify(this.cloudtrailEvent, null, 2));
    }
    console.log(err);
    console.log(err.stack);
    this.applicationContext.fail(err);
  }

  logDebugS3() {
    if (SETTINGS.DebugLogging) {
      console.log("CloudTrail S3 Object - Debug: " + JSON.stringify(this.cloudtrailEvent, null, 2));
    }
  }

  logDebugEvent(event) {
    if (SETTINGS.DebugLogging) {
      console.log("CloudTrail Event - Debug: " + JSON.stringify(event, null, 2));
    }
  }

  retrieveLogFileDetails() {
    return new Promise((resolve, reject) => {
      try {
        this.s3Region = this.cloudtrailEvent.Records[0].awsRegion;
        const logFiles = this.cloudtrailEvent.Records.map(event => {
          return { Bucket: event.s3.bucket.name, Key: event.s3.object.key };
        });
        resolve(logFiles);
      } catch (e) {
        reject(e);
      }
    });
  }

  async collectAndPerformAutotagActionsFromLogFile(logFiles) {
    for (let i in logFiles) {
      const log = await this.retrieveAndUnGzipLog(logFiles[i]);
      for (let j in log.Records) {
        const event = log.Records[j];
        // try/catch here so that if one record fails it will attempt
        // to finish the rest of the records from the log file
        try {
          if (!event.errorCode && !event.errorMessage) {
            const worker = AutotagFactory.createWorker(event, this.enabledServices, this.s3Region);
            await worker.tagResource();
            if (worker.constructor.name !== 'AutotagDefaultWorker') {
              this.logDebugEvent(event)
            }
          }
        } catch (err) {
          console.log("CloudTrail Event Failed (" + event.eventName + "): " + JSON.stringify(event, null, 2));
          console.log("S3 Object Event (" + event.eventName + "): " + JSON.stringify(this.cloudtrailEvent, null, 2));
          console.log(err);
          console.log(err.stack);
        }
      }
    }
  }

  async retrieveAndUnGzipLog(logFile) {
    const gzippedContent = await this.retrieveFromS3(logFile);
    const rawContent = await this.unGzipContent(gzippedContent);
    return rawContent;
  }

  retrieveFromS3(logFile) {
    return new Promise((resolve, reject) => {
      this.s3.getObject(logFile, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res.Body);
        }
      });
    });
  }

  unGzipContent(zippedContent) {
    return new Promise((resolve, reject) => {
      zlib.gunzip(zippedContent, (err, result) => {
        if (err) {
          reject(err);
        } else {
          const unzippedLog = result.toString() ? JSON.parse(result.toString()) : { Records: [] };
          resolve(unzippedLog);
        }
      });
    });
  }
}

const dumpRecord = (event) => {
  console.log('Event Name: ' + event.eventName);
  console.log('Event Type: ' + event.eventType);
  console.log('Event Source: ' + event.eventSource);
  console.log('AWS Region: ' + event.awsRegion);
  console.log('User Identity:');
  console.log(event.userIdentity);
  console.log('Request Parameters:');
  console.log(event.requestParameters);
  console.log('Response Elements:');
  console.log(event.responseElements);
  console.log('s3:');
  console.log(event.s3);
};

each(constants, (value, key) => {
  AwsCloudTrailLogListener[key] = value;
});

export default AwsCloudTrailLogListener;