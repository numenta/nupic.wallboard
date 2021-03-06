var path = require('path')
  , fs = require('fs')
  , _ = require('underscore')
  , Handlebars = require('handlebars')
  , request = require('request')
  , yaml = require('js-yaml')
  , express = require('express')
  , CONFIG =  require('config')
  , PORT = process.env.PORT || CONFIG.app.port
  , ajaxHandlersContainer = require('./server/ajaxHandlers')
  , ajaxHandlers
  , requestProxy = require('./server/requestProxy')
  , SprinterDash = require('sprinter-dash')
  , githubBadge = require('./server/github-badge')
  ;


function writeHtmlTemplate(name, layout) {
    var html;
    if (! layout && CONFIG.layout) {
        layout = CONFIG.layout;
    }
    html = fs.readFileSync(path.join(__dirname, 'layouts', layout + '.html'));
    fs.writeFileSync(path.join(__dirname, 'client', name + '.html'), html);
}

function getGlobalRepos(url, cb) {
    console.log('Fetching global repo list from %s', url);
    request.get(url, function(err, resp, body) {
        var repos;
        if (err) {
            return cb(err);
        }
        try {
            // Have to append the "---" line to the start of the YAML file or it
            // doesn't parse properly.
            repos = yaml.safeLoad("---\n" + body).repos;
            // Default branch is master.
            _.each(repos, function(repo) {
                if (! repo.branch) { repo.branch = 'master'; }
            });
        } catch(e) {
            throw new Error('Config file "' + url + '" is invalid YAML!');
        }
        cb(null, repos);
    });
}

function normalizeConfig(cfg) {
    if (cfg.refresh_rate) {
        _.each(cfg.monitors, function(monitor) {
            if (! monitor.refresh_rate) {
                monitor.refresh_rate = cfg.refresh_rate;
            }
        });
    }
    cfg.github = {
        username: process.env.GH_USERNAME
      , password: process.env.GH_PASSWORD
    };
}

function generateOneMonitorPageHandler(config, callback) {
    ajaxHandlersContainer.getMonitors(config.monitors, function(monitors) {
        var templateHtml = fs.readFileSync(path.join(__dirname, 'layouts/monitor.html'), 'utf-8')
          , template = Handlebars.compile(templateHtml);
        callback(function(req, res) {
            var monitor = req.params.monitorName
              , monitorConfig = monitors[monitor]
              , title = ''
              , body
              ;
            if (monitorConfig.options && monitorConfig.options.name) {
                title = monitorConfig.options.name;
            }
            body = template({
                title: title
                , monitorName: monitor
                , monitorConfig: JSON.stringify(monitorConfig)
            });
            res.end(body);
        });
    });
}

function startServer() {
    console.log('starting server');

    var app = express()
        .use(express.json())
        .use(express.urlencoded())
        .use(express.static(__dirname + '/client'))
        .get('/github-badge/:repo/:issue', githubBadge(CONFIG))
        // HTTP request proxy
        .use(requestProxy());

    generateOneMonitorPageHandler(CONFIG, function(oneMonitorHandler) {
        app.get('/monitor/:monitorName', oneMonitorHandler);
        // Adding handling for system ajax calls.
        _.each(ajaxHandlers, function(handler, path) {
            app.get(path, handler);
        });

        dash = new SprinterDash({
            repos: CONFIG.repos
          , travisOrg: 'numenta'
          , title: 'Numenta OS Issues'
        });
        dash.attach(app, '/');

        app.listen(PORT, function() {
            console.log('nupic.wallboard server running on\n'
            + '\thttp://localhost:' + PORT);
        });

    });

}

getGlobalRepos(CONFIG.repos_url, function(err, repos) {
    if (err) {
        throw err;
    }
    CONFIG.repos = repos;
    normalizeConfig(CONFIG);
    ajaxHandlers = ajaxHandlersContainer.initializer(CONFIG);
    writeHtmlTemplate('index', 'nupic');
    startServer();
});
