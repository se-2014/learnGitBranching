var _ = require('underscore');
var Q = require('q');
// horrible hack to get localStorage Backbone plugin
var Backbone = (!require('../util').isBrowser()) ? require('backbone') : window.Backbone;

var util = require('../util');
var Main = require('../app');

var Visualization = require('../visuals/visualization').Visualization;
var ParseWaterfall = require('../level/parseWaterfall').ParseWaterfall;
var DisabledMap = require('../level/disabledMap').DisabledMap;
var Command = require('../models/commandModel').Command;
var GitShim = require('../git/gitShim').GitShim;

var ModalTerminal = require('../views').ModalTerminal;
var ModalAlert = require('../views').ModalAlert;
var MultiView = require('../views/multiView').MultiView;

var Sandbox = Backbone.View.extend({
  // tag name here is purely vestigial. I made this a view
  // simply to use inheritance and have a nice event system in place
  tagName: 'div',
  initialize: function(options) {
    options = options || {};

    this.initVisualization(options);
    this.initCommandCollection(options);
    this.initParseWaterfall(options);
    this.initGitShim(options);

    if (!options.wait) {
      this.takeControl();
    }
  },

  getDefaultVisEl: function() {
    return $('#mainVisSpace')[0];
  },

  getAnimationTime: function() { return 700 * 1.5; },

  initVisualization: function(options) {
    this.mainVis = new Visualization({
      el: options.el || this.getDefaultVisEl()
    });
  },

  initCommandCollection: function(options) {
    // don't add it to just any collection -- adding to the
    // CommandUI collection will put in history
    this.commandCollection = Main.getCommandUI().commandCollection;
  },

  initParseWaterfall: function(options) {
    this.parseWaterfall = new ParseWaterfall();
  },

  initGitShim: function(options) {
  },

  takeControl: function() {
    // we will be handling commands that are submitted, mainly to add the sanadbox
    // functionality (which is included by default in ParseWaterfall())
    Main.getEventBaton().stealBaton('commandSubmitted', this.commandSubmitted, this);
    // we obviously take care of sandbox commands
    Main.getEventBaton().stealBaton('processSandboxCommand', this.processSandboxCommand, this);

    // a few things to help transition between levels and sandbox
    Main.getEventBaton().stealBaton('levelExited', this.levelExited, this);

    this.insertGitShim();
  },

  releaseControl: function() {
    // we will be handling commands that are submitted, mainly to add the sanadbox
    // functionality (which is included by default in ParseWaterfall())
    Main.getEventBaton().releaseBaton('commandSubmitted', this.commandSubmitted, this);
    // we obviously take care of sandbox commands
    Main.getEventBaton().releaseBaton('processSandboxCommand', this.processSandboxCommand, this);
    console.log('just released two things about to...');
    console.log(Main.getEventBaton());

    // a few things to help transition between levels and sandbox
    Main.getEventBaton().releaseBaton('levelExited', this.levelExited, this);

    this.releaseGitShim();
  },

  releaseGitShim: function() {
    if (this.gitShim) {
      this.gitShim.removeShim();
    }
  },

  insertGitShim: function() {
    // and our git shim goes in after the git engine is ready so it doesn't steal the baton
    // too early
    if (this.gitShim) {
      this.mainVis.customEvents.on('gitEngineReady', function() {
          this.gitShim.insertShim();
      },this);
    }
  },

  commandSubmitted: function(value) {
    // allow other things to see this command (aka command history on terminal)
    Main.getEvents().trigger('commandSubmittedPassive', value);

    util.splitTextCommand(value, function(command) {
      this.commandCollection.add(new Command({
        rawStr: command,
        parseWaterfall: this.parseWaterfall
      }));
    }, this);
  },

  startLevel: function(command, deferred) {
    var regexResults = command.get('regexResults') || [];
    var desiredID = regexResults[1] || '';
    var levelJSON = Main.getLevelArbiter().getLevel(desiredID);

    // handle the case where that level is not found...
    if (!levelJSON) {
      command.addWarning(
        'A level for that id "' + desiredID + '" was not found!!'
      );
      command.set('status', 'error');
      deferred.resolve();
      return;
    }

    // we are good to go!! lets prep a bit visually
    this.hide();
    this.clear();

    // we don't even need a reference to this,
    // everything will be handled via event baton :DDDDDDDDD
    var Level = require('../level').Level;
    var currentLevel = new Level({
      level: levelJSON
    });
    setTimeout(function() {
      command.finishWith(deferred);
    }, this.getAnimationTime());
  },

  exitLevel: function(command, deferred) {
    command.addWarning(
      "You aren't in a level! You are in a sandbox, start a level with `start level [id]`"
    );
    command.set('status', 'error');
    deferred.resolve();
  },

  processSandboxCommand: function(command, deferred) {
    var commandMap = {
      'help': this.helpDialog,
      'reset': this.reset,
      'delay': this.delay,
      'clear': this.clear,
      'exit level': this.exitLevel,
      'start level': this.startLevel
    };
    var method = commandMap[command.get('method')];
    if (!method) { throw new Error('no method for that wut'); }

    method.apply(this, [command, deferred]);
  },

  hide: function() {
    this.mainVis.hide();
  },

  levelExited: function() {
    this.show();
  },

  show: function() {
    this.mainVis.show();
  },

  clear: function(command, deferred) {
    Main.getEvents().trigger('clearOldCommands');
    if (command && deferred) {
      command.finishWith(deferred);
    }
  },

  delay: function(command, deferred) {
    var amount = parseInt(command.get('regexResults')[1], 10);
    setTimeout(function() {
      command.finishWith(deferred);
    }, amount);
  },

  reset: function(command, deferred) {
    this.mainVis.reset();
    setTimeout(function() {
      command.finishWith(deferred);
    }, this.mainVis.getAnimationTime());
  },

  helpDialog: function(command, deferred) {
    var helpDialog = new MultiView({
      childViews: require('../dialogs/sandbox').helpDialog
    });
    helpDialog.getPromise().then(_.bind(function() {
      // the view has been closed, lets go ahead and resolve our command
      command.finishWith(deferred);
    }, this))
    .done();
  }
});

exports.Sandbox = Sandbox;
