/* Script for testing the web client.

   This runs under CasperJS.  It's an end-to-end black-box sort of test.  It
   simulates clicking around in the app, sending messages, etc.  We run against
   a real development server instance and avoid mocking as much as possible.
*/

// Provides a few utility functions.
// See http://casperjs.org/api.html#utils
// For example, utils.dump() prints an Object with nice formatting.
var utils = require('utils');

// The main CasperJS object.
var casper = require('casper').create({
    // TODO: Expose these at the command line.
    //verbose:  true,
    //logLevel: 'debug',
});

// Get message headings (recipient rows) and bodies out of the DOM.
// casper.evaluate plays weird tricks with a closure, evaluating
// it in the web page's context.  Passing arguments from the test
// script's context is awkward (c.f. the various appearances of
// 'table' here).
function get_rendered_messages(table) {
    return casper.evaluate(function (table) {
        var tbl = $('#'+table);
        return {
            headings: $.map(tbl.find('.recipient_row .right_part'), function (elem) {
                return elem.innerText;
            }),

            bodies: $.map(tbl.find('.message_content'), function (elem) {
                return elem.innerHTML;
            })
        };
    }, {
        table: table
    });
}

function timestamp() {
    return new Date().getTime();
}

// The timestamp of the last message send or get_updates result.
var last_send_or_update = -1;

// Update that variable whenever get_updates returns.
casper.on('resource.received', function (resource) {
    if (/\/json\/get_updates/.test(resource.url)) {
        last_send_or_update = timestamp();
    }
});

// Send a Humbug message.
function send_message(type, params) {
    last_send_or_update = timestamp();

    casper.click('#left_bar_compose_' + type + '_button_big');
    casper.fill('form[action^="/json/send_message"]', params);
    casper.click('#compose-send-button');
}

// Wait for any previous send to finish, then send a message.
function wait_and_send(type, params) {
    casper.waitForSelector('#compose-send-button:enabled', function () {
        send_message(type, params);
    });
}

// Wait to receive queued messages.
function wait_for_receive(step) {
    // Wait until the last send or get_updates result was more than 100 ms ago.
    casper.waitFor(function () {
        return (timestamp() - last_send_or_update) > 300;
    }, step);
}

// innerText sometimes gives us non-breaking space characters, and occasionally
// a different number of spaces than we expect.
function normalize_spaces(str) {
    return str.replace(/\s+/g, ' ');
}

// Call get_rendered_messages and then check that the last few headings and
// bodies match the specified arrays.
function expected_messages(table, headings, bodies) {
    casper.test.assertVisible('#'+table,
        table + ' is visible');

    var msg = get_rendered_messages(table);

    casper.test.assertEquals(
        msg.headings.slice(-headings.length).map(normalize_spaces),
        headings,
        'Got expected message headings');

    casper.test.assertEquals(
        msg.bodies.slice(-bodies.length),
        bodies,
        'Got expected message bodies');
}

function un_narrow() {
    casper.test.info('Un-narrowing');
    casper.click('.narrowed_to_bar .close');
}

// Start of test script.
casper.start('http://localhost:9981/', function () {
    casper.test.assertHttpStatus(302);
    casper.test.assertUrlMatch(/^http:\/\/[^\/]+\/accounts\/home/, 'Redirected to /accounts/home');
    casper.click('a[href^="/accounts/login"]');
});

// casper.then will perform the action after the effects of previous clicks etc. are finished.
casper.then(function () {
    casper.test.info('Logging in');
    casper.fill('form[action^="/accounts/login"]', {
        username: 'iago@humbughq.com',
        password: 'FlokrWdZefyEWkfI'
    }, true /* submit form */);
});

casper.then(function () {
    // URL like http://localhost:9981/ or http://localhost:9981/#
    casper.test.assertUrlMatch(/^http:\/\/[^\/]+\/#?$/, 'On home page');

    casper.test.info('Sanity-checking existing messages');

    var msg = get_rendered_messages('zhome');

    msg.headings.forEach(function (heading) {
        casper.test.assertMatch(normalize_spaces(heading),
            /(^You and )|( \| )/,
            'Heading is well-formed');
    });

    msg.bodies.forEach(function (body) {
        casper.test.assertMatch(body,
            /^(<p>(.|\n)*<\/p>)?$/,
            'Body is well-formed');
    });

    casper.test.info('Sending messages');

    send_message('stream', {
        stream:  'Verona',
        subject: 'frontend test',
        content: 'test message A'
    });
});

wait_and_send('stream', {
    stream:  'Verona',
    subject: 'frontend test',
    content: 'test message B'
});

wait_and_send('stream', {
    stream:  'Verona',
    subject: 'other subject',
    content: 'test message C'
});

wait_and_send('private', {
    recipient: 'cordelia@humbughq.com, hamlet@humbughq.com',
    content:   'personal A'
});

wait_and_send('private', {
    recipient: 'cordelia@humbughq.com, hamlet@humbughq.com',
    content:   'personal B'
});

wait_and_send('private', {
    recipient: 'cordelia@humbughq.com',
    content:   'personal C'
});

wait_for_receive(function () {
    expected_messages('zhome', [
        'Verona | frontend test',
        'Verona | other subject',
        'You and Cordelia Lear, King Hamlet',
        'You and Cordelia Lear'
    ], [
        '<p>test message A</p>',
        '<p>test message B</p>',
        '<p>test message C</p>',
        '<p>personal A</p>',
        '<p>personal B</p>',
        '<p>personal C</p>'
    ]);

    casper.test.info('Sending more messages');

    send_message('stream', {
        stream:  'Verona',
        subject: 'frontend test',
        content: 'test message D'
    });
});

wait_and_send('private', {
    recipient: 'cordelia@humbughq.com, hamlet@humbughq.com',
    content:   'personal D'
});

wait_for_receive(function () {
    casper.test.info('Narrowing to stream');
    casper.click('*[title="Narrow to stream \\\"Verona\\\""]');
});

casper.then(function () {
    expected_messages('zfilt', [
        'Verona | frontend test',
        'Verona | other subject',
        'Verona | frontend test',
    ], [
        '<p>test message A</p>',
        '<p>test message B</p>',
        '<p>test message C</p>',
        '<p>test message D</p>',
    ]);

    un_narrow();
});

casper.then(function () {
    expected_messages('zhome', [
        'Verona | frontend test',
        'You and Cordelia Lear, King Hamlet'
    ], [
        '<p>test message D</p>',
        '<p>personal D</p>'
    ]);

    casper.test.info('Narrowing to subject');
    casper.click('*[title="Narrow to stream \\\"Verona\\\", subject \\\"frontend test\\\""]');
});

casper.then(function () {
    expected_messages('zfilt', [
        'Verona | frontend test',
    ], [
        '<p>test message A</p>',
        '<p>test message B</p>',
        '<p>test message D</p>',
    ]);

    un_narrow();
});

casper.then(function () {
    casper.test.info('Narrowing to personals');
    casper.click('*[title="Narrow to your private messages with Cordelia Lear, King Hamlet"]');
});

casper.then(function () {
    expected_messages('zfilt', [
        'You and Cordelia Lear, King Hamlet',
    ], [
        '<p>personal A</p>',
        '<p>personal B</p>',
        '<p>personal D</p>',
    ]);
});

// Run the above queued actions.
casper.run(function () {
    casper.exit((casper.test.getFailures().length > 0) ? 1 : 0);
});
