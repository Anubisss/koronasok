# Koronasok
The project is no longer maintained and the website is no longer available.

Koronasok is a simple scheduled AWS Lambda function (managed via Serverless) which generates a HTML file and puts it into an AWS S3 bucket.
It generates content for koronasok.hu which is a website for tracking infections of Coronavirus disease (COVID-19) in Hungary.

The website was here: https://koronasok.hu/

It looked like this: https://i.imgur.com/snVKEJ9.png

### Note
This is not an official product. Created for fun and personal usage.

Original list: https://koronavirus.gov.hu/

### Deployment
1. ```npm install```
2. ```./node_modules/.bin/serverless deploy --host-s3-bucket-name S3_BUCKET_NAME```

Check the serverless.yml file for further options.

### License
The MIT License (MIT)
