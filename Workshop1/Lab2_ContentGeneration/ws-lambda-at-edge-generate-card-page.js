'use strict';

const http = require('https');
const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient({apiVersion: '2012-10-08', region: 'us-east-1'});

const ddbTableName = FIXME; // Copy DynamoDB table name here, for example, 'AlienCards-1201c610'
const cfDomainName = FIXME; // Copy CloudFront domain name here, for example, 'd1dienny4yhppe.cloudfront.net';
const pathCardTmpl = '/templates/card.html';

// The generated page contains some dynamic data, so we don't want
// it to stay in cache for long
const cacheControlMaxAge = 3;

exports.handler = (event, context, callback) => {
    console.log('Event: ', JSON.stringify(event, null, 2));
    console.log('Context: ', JSON.stringify(context, null, 2));
    const request = event.Records[0].cf.request;

    // Get Id from URI (pass through if failed to parse)
    const m = request.uri.match(/^\/card\/([a-z0-9]+)$/i);
    const id = (Array.isArray(m) && m.length > 1) ? m[1] : null;
    if (!id) {
        // Couldn't get id from URI, don't generate any response
        // in this case, let the request go to the origin
        return callback(null, request);
    }

    // Get HTML template from the CloudFront cache
    // and data from the DynamoDB table
    Promise.all([
        httpGet({ hostname: cfDomainName, path: pathCardTmpl }),
        ddbGet({ TableName: ddbTableName, Key: { CardId: id } }),
    ])
    .then(responses => {
        const tmpl = responses[0];
        const data = responses[1];

        // Replace the placeholders in the template with actual data
        const html = tmpl
            .replace(/{{message}}/g, 'HTML Generated by Lambda@Edge')
            .replace(/{{id}}/g, id)
            .replace(/{{description}}/g, data.Description)
            .replace(/{{likes}}/g, data.Likes);

        callback(null, getResponseOK(html));
    })
    .catch(error => {
        callback(null, getResponseError(error));
    });
};

function getResponseOK(html) {
    return {
        status: '200',
        statusDescription: 'OK',
        headers: addSecurityHeaders({
            'cache-control': [{ key: 'Cache-Control', value: `max-age=${cacheControlMaxAge}` }],
            'content-type': [{ key: 'Content-Type',  value: 'text/html;charset=UTF-8' }]
        }),
        body: html
    };
}

function getResponseError(error) {
    return {
        status: '500',
        statusDescription: 'Internal Server Error',
        headers: addSecurityHeaders({
            'content-type': [{ key: 'Content-Type',  value: 'application/json' }]
        }),
        body: JSON.stringify(error, null, 2)
    };
}

function httpGet(params) {
    console.log(`Fetching ${params.hostname}${params.path}`);
    return new Promise((resolve, reject) => {
        http.get(params, (resp) => {
            console.log('Response status code:: ' + resp.statusCode);
            let data = '';
            resp.on('data', (chunk) => { data += chunk; });
            resp.on('end', () => { resolve(data); });
        }).on('error', (err) => {
            console.log(`Couldn't fetch ${params.hostname}${params.path} : ${err.message}`);
            reject(err, null);
        });
    });
}

function ddbGet(params) {
    console.log('DDB get params: ' + JSON.stringify(params, null, 2));
    return new Promise((resolve, reject) =>
        ddb.get(params, (err, data) => {
            if (err) {
                console.log('ddb err: ' + JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log('ddb data: ' + JSON.stringify(data, null, 2));
                if (data.Item)
                    resolve(data.Item);
                else
                    reject('No item found: ' + JSON.stringify(params));
            }
        })
    );
}

function addSecurityHeaders(headers) {
    headers['strict-transport-security'] = [{
        key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains'
    }];
    headers['content-security-policy'] = [{
        key: 'Content-Security-Policy', value: "default-src 'self'"
    }];
    headers['x-xss-protection'] = [{
        key: 'X-XSS-Protection', value: '1; mode=block'
    }];
    headers['x-content-type-options'] = [{
        key: 'X-Content-Type-Options', value: 'nosniff'
    }];
    headers['x-frame-options'] = [{
        key: 'X-Frame-Options', value: 'DENY'
    }];
    return headers;
}
