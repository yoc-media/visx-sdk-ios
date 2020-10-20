 (function () {
     var isIOS = (/iphone|ipad|ipod/i).test(window.navigator.userAgent);
     if (isIOS && typeof console === 'undefined') {
         console = {};
         console.log = function (log) {
             var iframe = document.createElement('iframe');
             iframe.setAttribute('src', 'ios-log: ' + log);
             document.documentElement.appendChild(iframe);
             iframe.parentNode.removeChild(iframe);
             iframe = null;
         };
         console.debug = console.info = console.warn = console.error = console.groupCollapsed = console.groupEnd = console.log;
     }
 }());
(function () {
    // Establish the root mraidbridge object.
    var mraidbridge = window.mraidbridge = {};
    // Listeners for bridge events.
    var listeners = {};
    // Queue to track pending calls to the native SDK.
    var nativeCallQueue = [];
    // Whether a native call is currently in progress.
    var nativeCallInFlight = false;
    // ////////////////////////////////////////////////////////////////////////////////////////////////
    mraidbridge.fireReadyEvent = function () {
        mraidbridge.fireEvent('ready');
    };
    
    mraidbridge.fireExposureEvent = function (properties) {
        mraid.exposureChange(properties.exposedPercentage,
                             properties.visibleRectangle,
                             properties.occlusionRectangles);
    };
    
    mraidbridge.fireChangeEvent = function (properties) {
        //console.log(JSON.stringify(properties, null, 2));
        mraidbridge.fireEvent('change', properties);
    };
    mraidbridge.fireSuccessEvent = function (action) {
        console.log("mraidbridge.fireSuccessEvent action= " + action);
        mraidbridge.fireEvent('success', action);
    };
    mraidbridge.fireErrorEvent = function (message, action) {
        mraidbridge.fireEvent('error', message, action);
    };
    mraidbridge.fireEvent = function (type) {
        var ls = listeners[type];
        if (ls) {
            var args = Array.prototype.slice.call(arguments);
            args.shift();
            var l = ls.length;
            for (var i = 0; i < l; i++) {
                ls[i].apply(null, args);
            }
        }
    };
    mraidbridge.setSupportFeature = function (feature, value) {
        window.mraid.setSupportFeature(feature, value);
    };
    mraidbridge.nativeCallComplete = function (command) {
        if (nativeCallQueue.length === 0) {
            nativeCallInFlight = false;
            return;
        }
        var nextCall = nativeCallQueue.shift();
        window.location = nextCall;
    };
    mraidbridge.executeNativeCall = function (command) {
        var call = 'mraid://' + command;
        var key, value;
        var isFirstArgument = true;
        for (var i = 1; i < arguments.length; i += 2) {
            key = arguments[i];
            value = arguments[i + 1];
            if (value === null) continue;
            if (isFirstArgument) {
                call += '?';
                isFirstArgument = false;
            } else {
                call += '&';
            }
            call += key + '=' + encodeURI(value);
        }
        if (nativeCallInFlight) {
            nativeCallQueue.push(call);
        } else {
            nativeCallInFlight = true;
            window.location = call;
        }
    };
    // ////////////////////////////////////////////////////////////////////////////////////////////////
    mraidbridge.getOrientationProperties = function () {
        
        var properties = mraid.getOrientationProperties();
        var jsonStr = JSON.stringify(properties);
        
        return jsonStr;
    };
    // ////////////////////////////////////////////////////////////////////////////////////////////////
    mraidbridge.addEventListener = function (event, listener) {
        var eventListeners;
        listeners[event] = listeners[event] || [];
        eventListeners = listeners[event];
        for (var l in eventListeners) {
            // Listener already registered, so no need to add it.
            if (listener === l) return;
        }
        eventListeners.push(listener);
    };
    mraidbridge.removeEventListener = function (event, listener) {
        if (listeners.hasOwnProperty(event)) {
            var eventListeners = listeners[event];
            if (eventListeners) {
                var idx = eventListeners.indexOf(listener);
                if (idx !== -1) {
                    eventListeners.splice(idx, 1);
                }
            }
        }
    };
}());
(function () {
    var mraid = window.mraid = {};
    var bridge = window.mraidbridge; // Constants.
    // ////////////////////////////////////////////////////////////////////////////////////
    var VERSION = mraid.VERSION = '2.0';
    // Used to track the version of the iOS SDK
    var SDKVERSION = mraid.SDKVERSION = "1.0";
    
    var STATES = mraid.STATES = {
    LOADING: 'loading',
        // Initial state.
    DEFAULT: 'default',
    EXPANDED: 'expanded',
    RESIZED: 'resized',
    HIDDEN: 'hidden'
    };
    var EVENTS = mraid.EVENTS = {
    ERROR: 'error',
    INFO: 'info',
    READY: 'ready',
    STATECHANGE: 'stateChange',
    VIEWABLECHANGE: 'viewableChange',
    KEYBOARDCHANGE: 'keyboardChange',
    VOLUMECHANGE: 'volumeChange',
    SIZECHANGE: 'sizeChange',
    URLSCHEMESUPPORTED: 'urlschemesupported',
    EXPOSURECHANGE: 'exposureChange',
    SUCCESS: 'success'
    };
    var PLACEMENT_TYPES = mraid.PLACEMENT_TYPES = {
    INLINE: 'inline',
    INTERSTITIAL: 'interstitial'
    };
    var CLOSEBTUTTONPOS = mraid.CLOSEBTUTTONPOS = {
    TL: 'top-left',
    TR: 'top-right',
    BL: 'bottom-left',
    BR: 'bottom-right'
    };
    var FEATURES = mraid.FEATURES = {
    SMS: 'sms',
    CALENDAR: 'calendar',
    VIDEO: 'inlineVideo',
    PICTURE: 'storePicture',
    EXPOSURECHANGE: 'exposureChange'
    };
    var supports = {
        'screen': false,
        'sms': false,
        'calendar': false,
        'inlineVideo': true,
        'tel': false,
        'storePicture': false,
        'exposureChange': true
    };
    // External MRAID state: may be directly or indirectly modified by the ad JS.
    ////////////////////
    // Properties which define the behavior of an expandable ad.
    var expandProperties = {
    width: -1,
    height: -1,
    useCustomClose: false,
    isModal: true
    };
    
    // Properties wich control the orientation of an expandable and interstitial ad.
    var orientationProperties = {
    allowOrientationChange: true,
    forceOrientation: "none"
    };
    // Properties which define the behavior of a resizeable ad.
    var resizeProperties = {
    width: -1,
    height: -1,
    customClosePosition: CLOSEBTUTTONPOS.TR,
    offsetX: 0,
    offsetY: 0,
    allowOffscreen: false
    };
    // Properties for presenting a modal view controller
    var modalVCProperties = {
    backgroundColor: "FFFFFF",
    alpha: 1.0,
    isMraid: false,
    transitionStyle: 'curl'
    };
    var hasSetCustomSize = false;
    var hasSetCustomClose = false;
    var listeners = {};
    // Internal MRAID state. Modified by the native SDK.
    // /////////////////////////////////////////////
    var state = STATES.LOADING;
    var isViewable = false;
    var screenSize = {
    width: -1,
    height: -1
    };
    /* Not used in MRAID 2.0
     var realScreenSizeInPixel = {
     width : -1,
     height : -1
     };
     */
    var defaultPosition = {
    x: 0,
    y: 0,
    width: -1,
    height: -1
    };
    
    var isMediationAdView = false;
    
    var density = 1;
    
    var currentPosition = {
    x: 0,
    y: 0,
    width: -1,
    height: -1
    };
    var maxSize = {
    width: -1,
    height: -1
    };
    
    var absSize = {
        x : 0,
        y : 0,
        width : 0,
        height : 0
    };
    
    var placementEffect = '';
    
    var webviewDimension = {
        width : 0,
        height : 0
    };
    
    var viewportDimension = {
        width : 0,
        height : 0
    };
    
    var isExposureChangeEnabled = true;
    var keyboardState = false;
    var volumeLevel = 0;
    var scale = 1;
    var placementType = PLACEMENT_TYPES.INLINE;
    
    // ////////////////////////////////////////////////////////////////////////////////////////////////
    // / SUPPORT DYNAMIC VALUES CHANGING FOR MRAID 2.0 //
    bridge.modifyMraidSupports = function (sms, tel, storedPic, calendar) {
        //supports["sms"] = sms;
        //supports["tel"] = tel;
        //supports["storePicture"] = storedPic;
        //supports["calendar"] = calendar;
        /* support is set to false as long as we haven't fully tested all features */
        supports["sms"] = false;
        supports["tel"] = tel;
        supports["storePicture"] = false;
        supports["calendar"] = false;
    };
    
    var EventListeners = function (event) {
        this.event = event;
        this.count = 0;
        var listeners = {};
        this.add = function (func) {
            var id = String(func);
            if (!listeners[id]) {
                listeners[id] = func;
                this.count++;
            }
        };
        this.remove = function (func) {
            var id = String(func);
            if (listeners[id]) {
                listeners[id] = null;
                delete listeners[id];
                this.count--;
                return true;
            } else {
                return false;
            }
        };
        this.removeAll = function () {
            for (var id in listeners) {
                if (listeners.hasOwnProperty(id)) this.remove(listeners[id]);
            }
        };
        this.broadcast = function (args) {
            for (var id in listeners) {
                if (listeners.hasOwnProperty(id)) listeners[id].apply({}, args);
            }
        };
        this.toString = function () {
            var out = [event, ':'];
            for (var id in listeners) {
                if (listeners.hasOwnProperty(id)) out.push('|', id, '|');
            }
            return out.join('');
        };
    };
    var broadcastEvent = function () {
        var args = new Array(arguments.length);
        var l = arguments.length;
        for (var i = 0; i < l; i++) args[i] = arguments[i];
        var event = args.shift();
        if (listeners[event]) listeners[event].broadcast(args);
    };
    var contains = function (value, array) {
        for (var i in array) {
            if (array[i] === value) return true;
        }
        return false;
    };
    var clone = function (obj) {
        if (obj === null) return null;
        var f = function () {};
        f.prototype = obj;
        return new f();
    };
    var stringify = function (obj) {
        if (typeof obj === 'object') {
            var out = [];
            if (obj.push) { // Array.
                for (var p in obj) out.push(obj[p]);
                return '[' + out.join(',') + ']';
            } else { // Other object.
                for (var p in obj) out.push("'" + p + "': " + obj[p]);
                return '{' + out.join(',') + '}';
            }
        } else return String(obj);
    };
    var trim = function (str) {
        return str.replace(/^\s+|\s+$/g, '');
    };
    var concatArguments = function (eventName, data) {
        var args = [eventName];
        for (obj in data) {
            args = args.concat([obj, data[obj]]);
        }
        return args;
    };
    // Functions that will be invoked by the native SDK whenever a "change" event occurs.
    var changeHandlers = {
    state: function (val) {
        if (state === STATES.LOADING) {
            broadcastEvent(EVENTS.INFO, 'Native SDK initialized.');
        }
        state = val;
        console.log("state was changed state="+state);
        broadcastEvent(EVENTS.INFO, 'Set state to ' + stringify(val));
        broadcastEvent(EVENTS.STATECHANGE, state);
    },
    viewable: function (val) {
        console.log("mraid.js function viewable("+val+")");
        isViewable = val;
        broadcastEvent(EVENTS.INFO, 'Set isViewable to ' + stringify(val));
        broadcastEvent(EVENTS.VIEWABLECHANGE, isViewable);
    },
    placementType: function (val) {
        broadcastEvent(EVENTS.INFO, 'Set placementType to ' + stringify(val));
        placementType = val;
    },
    screenSize: function (val) {
        broadcastEvent(EVENTS.INFO, 'Set screenSize to ' + stringify(val));
        for (var key in val) {
            if (val.hasOwnProperty(key)) screenSize[key] = val[key];
        }
        if (!hasSetCustomSize) {
            expandProperties['width'] = screenSize['width'];
            expandProperties['height'] = screenSize['height'];
        }
    },
    success: function (val) {
        console.log("fire success broadcast with " + val);
        broadcastEvent(EVENTS.SUCCESS, val);
    },
    defaultPosition: function (val) {
        broadcastEvent(EVENTS.INFO, 'Setting default position ' + stringify(val));
        defaultPosition['x'] = val['x'];
        defaultPosition['y'] = val['y'];
        defaultPosition['width'] = val['width'];
        defaultPosition['height'] = val['height'];
    },
    currentPosition: function (val) {
        broadcastEvent(EVENTS.INFO, 'Setting current position ' + stringify(val));
        currentPosition['x'] = val['x'];
        currentPosition['y'] = val['y'];
        currentPosition['width'] = val['width'];
        currentPosition['height'] = val['height'];
    },
    maxSize: function (val) {
        broadcastEvent(EVENTS.INFO, 'Setting maximum size the ad can expand to ' + stringify(val));
        maxSize['width'] = val['width'];
        maxSize['height'] = val['height'];
    },
    size: function (val) {
        broadcastEvent(EVENTS.INFO, 'Ad Size changed to: ' + stringify(val));
        broadcastEvent(EVENTS.SIZECHANGE, val);
    },
    volume: function (val) {
        broadcastEvent(EVENTS.INFO, 'Volume changed to: ' + stringify(val));
        volumeLevel = val;
        broadcastEvent(EVENTS.VOLUMECHANGE, val);
    },
    scale: function (val) {
        broadcastEvent(EVENTS.INFO, 'Scale changed to: ' + stringify(val));
        scale = val;
    },
    expandProperties: function (val) {
        broadcastEvent(EVENTS.INFO, 'Merging expandProperties with ' + stringify(val));
        for (var key in val) {
            if (val.hasOwnProperty(key)) expandProperties[key] = val[key];
        }
    },
    keyboard: function (val) {
        broadcastEvent(EVENTS.INFO, 'setting keyboardState to ' + stringify(val));
        keyboardState = val;
        broadcastEvent(EVENTS.KEYBOARDCHANGE, keyboardState);
    },
    urlschemesupported: function (val) {
        broadcastEvent(EVENTS.INFO, 'urlscheme supported: ' + stringify(val));
        broadcastEvent(EVENTS.URLSCHEMESUPPORTED, val);
    }
    };
    var validate = function (obj, validators, action, merge) {
        if (!merge) {
            // Check to see if any required properties are missing.
            if (obj === null) {
                broadcastEvent(EVENTS.ERROR, 'Required object not provided.', action);
                return false;
            } else {
                for (var i in validators) {
                    if (validators.hasOwnProperty(i) && obj[i] === undefined) {
                        broadcastEvent(EVENTS.ERROR, 'Object is missing required property: ' + i + '.', action);
                        return false;
                    }
                }
            }
        }
        for (var prop in obj) {
            var validator = validators[prop];
            var value = obj[prop];
            if (validator && !validator(value)) { // Failed validation.
                broadcastEvent(EVENTS.ERROR, 'Value of property ' + prop + ' is invalid.', action);
                return false;
            }
        }
        return true;
    };
    var expandPropertyValidators = {
    width: function (v) {
        return !isNaN(v) && v >= 0;
    },
    height: function (v) {
        return !isNaN(v) && v >= 0;
    },
    useCustomClose: function (v) {
        return (typeof v === 'boolean');
    },
    expandPosition: function (v) {
        return (v == 'top' || v == 'center' || v == 'bottom');
    }
    };
    var orientationPropertyValidators = {
    forceOrientation: function (v) {
        return (v == 'portrait' || v == 'landscape' || v == 'none');
    },
    allowOrientationChange:function (v) {
        return (typeof v === 'boolean');
    }
    };
    var resizePropertyValidators = {
    width: function (v) {
        return !isNaN(v) && v >= 0;
    },
    height: function (v) {
        return !isNaN(v) && v >= 0;
    },
    offsetX: function (v) {
        return !isNaN(v);
    },
    offsetY: function (v) {
        return !isNaN(v);
    },
    customClosePosition: function (v) {
        return (v == CLOSEBTUTTONPOS.BL || v == CLOSEBTUTTONPOS.BR || v == CLOSEBTUTTONPOS.TL || v == CLOSEBTUTTONPOS.TR);
    },
    allowOffscreen: function (v) {
        return (typeof v === 'boolean');
    }
    };
    var modalVCPropertyValidators = {
    alpha: function (v) {
        return !isNaN(v);
    },
    backgroundColor: function (v) {
        return (typeof v === 'string');
    },
    isMraid: function (v) {
        return (typeof v === 'boolean');
    },
    transitionStyle: function (v) {
        return (v == "moveUp" || v == "flipRight" || v == "fadeIn" || v == "curlUp");
    }
    };
    // ////////////////////////////////////////////////////////////////////////////////////////////////
    bridge.addEventListener('change', function (properties) {
        for (var p in properties) {
            if (properties.hasOwnProperty(p)) {
                var handler = changeHandlers[p];
                handler(properties[p]);
            }
        }
    });
    bridge.addEventListener('error', function (message, action) {
        broadcastEvent(EVENTS.ERROR, message, action);
    });
    bridge.addEventListener('success', function (action) {
        broadcastEvent(EVENTS.SUCCESS, action);
    });
    bridge.addEventListener('ready', function () {
        broadcastEvent(EVENTS.READY);
    });
    
    // ////////////////////////////////////////////////////////////////////////////////////////////////
    
    mraid.addEventListener = function (event, listener) {
        if (!event || !listener) {
            broadcastEvent(EVENTS.ERROR, 'Both event and listener are required.', 'addEventListener');
        } else if (!contains(event, EVENTS)) {
            broadcastEvent(EVENTS.ERROR, 'Unknown MRAID event: ' + event, 'addEventListener');
        } else {
            if (!listeners[event]) listeners[event] = new EventListeners(event);
            listeners[event].add(listener);
            if (event == EVENTS.VOLUMECHANGE) {
                bridge.executeNativeCall('enableVolumeControl', 'setting', 'true');
            }
        }
    };
    mraid.close = function () {
        // if (state === STATES.HIDDEN) {
        // broadcastEvent(EVENTS.ERROR, 'Ad cannot be closed when it is already
        // hidden.', 'close');
        // } else {
        bridge.executeNativeCall('close');
        console.log("bridge.executeNativeCall('close')");
        // }
    };
    
    mraid.getDensity = function() {
        console.log("mraid.getDensity() density="+density);
        return density;
    };
    
    mraid.setDensity = function(dens) {
        if(dens <= 0) {
            broadcastEvent(EVENTS.ERROR, 'Density can\'t be set to a value <= 0', 'setDensity');
            return;
        }
        
        density = dens;
        console.log("mraid.setDensity() successful changed density="+density);
    };
    
    mraid.setIsMediationAdView = function(val) {
        isMediationAdView = val;
    };
    
    mraid.getIsMediationAdView = function() {
        return isMediationAdView;
    };
    
    mraid.flip = function (transitionStyle, duration, url) {
        bridge.executeNativeCall('flip', "transitionStyle", transitionStyle, "duration", duration, "url", url);
    };
    mraid.presentWithAnimationStyle = function (animationStyle) {
        if (animationStyle != "flipFromRight" && animationStyle != "flipFromLeft" && animationStyle != "flipFromTop" && animationStyle != "flipFromBottom") {
            animationStyle = "blend";
        }
        bridge.executeNativeCall('presentwithanimation', "animationStyle", animationStyle);
    };
    mraid.openModalVCWithURL = function (URL) {
        var args = ['openmodalvc'];
        args = args.concat(['url', URL]);
        args = args.concat(['isMraid', modalVCProperties.isMraid]);
        args = args.concat(['style', modalVCProperties.transitionStyle]);
        args = args.concat(['color', modalVCProperties.backgroundColor]);
        args = args.concat(['alpha', modalVCProperties.alpha]);
        bridge.executeNativeCall.apply(this, args);
    };
    mraid.expand = function (URL) {
        if (state !== STATES.DEFAULT) {
            broadcastEvent(EVENTS.ERROR, 'Ad can only be expanded from the default state.', 'expand');
        } else {
            var args = ['expand'];
            if (hasSetCustomClose) {
                args = args.concat(['shouldUseCustomClose', expandProperties.useCustomClose ? 'true' : 'false']);
            }
            if (hasSetCustomSize) {
                if (expandProperties.width >= 0 && expandProperties.height >= 0) {
                    args = args.concat(['w', expandProperties.width, 'h', expandProperties.height]);
                }
            }
            if (typeof expandProperties.expandPosition !== 'undefined') {
                args = args.concat(['expandPosition', expandProperties.expandPosition]);
            } else {
                args = args.concat(['expandPosition', 'center']);
            }
            if (URL && URL != "") {
                args = args.concat(['url', URL]);
            }
            bridge.executeNativeCall.apply(this, args);
        }
    };
    mraid.getExpandProperties = function () {
        var properties = {
        width: expandProperties.width,
        height: expandProperties.height,
        useCustomClose: expandProperties.useCustomClose,
        isModal: expandProperties.isModal
        };
        return properties;
    };
    mraid.getOrientationProperties = function () {
        var properties = {
        allowOrientationChange: orientationProperties.allowOrientationChange,
        forceOrientation: orientationProperties.forceOrientation,
        };
        return properties;
    };
    mraid.resize = function (animated, legacy) {
        var legacy = (typeof legacy === "undefined") ? false : legacy;
        var args;
        
        if(legacy) {
            args = ['backwardCompatibleResize'];
        } else {
            args = ['resize'];
        }
        
        args = args.concat(['width', resizeProperties.width, 'height', resizeProperties.height]);
        args = args.concat(['offsetX', resizeProperties.offsetX, 'offsetY', resizeProperties.offsetY]);
        args = args.concat(['customClosePosition', resizeProperties.customClosePosition, 'allowOffscreen', resizeProperties.allowOffscreen]);
        if (animated != undefined) args = args.concat(['animated', animated]);
        else args = args.concat(['animated', 'true']);
        bridge.executeNativeCall.apply(this, args);
    };
    mraid.getResizeProperties = function () {
        var properties = {
        width: resizeProperties.width,
        height: resizeProperties.height,
        offsetX: resizeProperties.offsetX,
        offsetY: resizeProperties.offsetY,
        customClosePosition: resizeProperties.customClosePosition,
        allowOffscreen: resizeProperties.allowOffscreen
        };
        return properties;
    };
    mraid.getPlacementType = function () {
        return placementType;
    };
    mraid.getState = function () {
        return state;
    };
    mraid.getAbsoluteScreenSize = function () {
        console.log("mraid.getAbsoluteScreenSize() will return maxSize="+absSize);
        return absSize;
    };
    mraid.getVersion = function () {
        return mraid.VERSION;
    };
    mraid.getSDKVersion = function () {
        return mraid.SDKVERSION;
    };
    mraid.getDefaultPosition = function () {
        return defaultPosition;
    };
    mraid.getCurrentPosition = function () {
        return currentPosition;
    };
    mraid.getSize = function () {
        var size = {
        width: currentPosition.width,
        height: currentPosition.height
        };
        return size;
    };
    mraid.getMaxSize = function () {
        return maxSize;
    };
    mraid.isViewable = function () {
        return isViewable;
    };
    mraid.getScreenSize = function () {
        return screenSize;
    };
    mraid.getVolumeLevel = function () {
        return volumeLevel;
    };
    mraid.getScale = function () {
        return scale;
    };
    mraid.getKeyboardState = function () {
        if (!supports[FEATURES.LEVEL2]) {
            broadcastEvent(EVENTS.ERROR, 'Method not supported by this client.', 'getKeyboardState');
        }
        return keyboardState;
    };
    mraid.getExposureChangeAvailability = function() {
        console.log("mraid.js function mraid.getExposureChangeAvailability()");
        if (![FEATURES.EXPOSURECHANGE]) {
            broadcastEvent(EVENTS.ERROR, 'Method not supported by this client.', 'getExposureChange');
        }
        return isExposureChangeEnabled;
    };
    mraid.sendSMS = function (data) {
        broadcastEvent(EVENTS.ERROR, 'Method is not supported.', 'sendSMS');
    };
    mraid.storePicture = function (data) {
        broadcastEvent(EVENTS.ERROR, 'Method is not supported.', 'storePicture');
    };
    mraid.createCalendarEvent = function (data) {
        broadcastEvent(EVENTS.ERROR, 'Method is not supported.', 'createCalendarEvent');
    };
    mraid.playVideo = function (data) {
        if (!supports[FEATURES.VIDEO]) {
            broadcastEvent(EVENTS.ERROR, 'Method not supported by this client.', 'playVideo');
        } else if (!data) {
            broadcastEvent(EVENTS.ERROR, 'Request must specify a url.', 'playVideo');
        } else if (typeof data == 'string') {
            bridge.executeNativeCall('playVideo', 'url', data);
        } else if (typeof data == 'object') {
            bridge.executeNativeCall.apply(this, concatArguments('playVideo', data));
        }
    };
    mraid.supports = function (feature) {
        if (supports[feature]) {
            return true;
        } else {
            return false;
        }
    };
    mraid.isURLSchemeSupported = function (scheme) {
        if (!scheme) {
            broadcastEvent(EVENTS.ERROR, 'Request must specify event data.', 'isURLSchemeSupported');
        }else{
            console.log("isURLSchemeSupported is supported");
            bridge.executeNativeCall('isURLSchemeSupported', 'urlScheme', scheme);
        }
    };
    
    mraid.setAbsSize = function(width, height) {
        absSize.width = width;
        absSize.height = height;
        console.log("mraid.setAbsSize() set with width="+absSize.width+" and height="+absSize.height);
    };
    
    mraid.exposureChange = function (exposedPercentage, visibleRectangle, occlusionRectangles) {
        broadcastEvent(EVENTS.EXPOSURECHANGE, exposedPercentage, visibleRectangle, occlusionRectangles);
    };
    
    mraid.visxSetPlacementDimension = function(webviewWidth, webviewHeight, viewportWidth, viewportHeight) {
        webviewDimension.width = webviewWidth;
        webviewDimension.height = webviewHeight;
        viewportDimension.width = viewportWidth;
        viewportDimension.height = viewportHeight;
        bridge.executeNativeCall('visxSetPlacementDimension', 'webviewWidth', webviewWidth, 'webviewHeight', webviewHeight, 'viewportWidth', viewportWidth, 'viewportHeight', viewportHeight);
    };
    
    mraid.visxSetTypeEffect = function(effect) {
        console.log("changed typeEffect");
        placementEffect = String(effect);
        console.log(placementEffect);
    };
    
    mraid.visxSetPlacementEffect = function(effect, webviewWidth, webviewHeight, viewportWidth, viewportHeight) {
        console.log("the effect is " + effect);
        placementEffect = effect;
        console.log("the effect is stored in placementEffect = " + placementEffect);
        webviewDimension.width = webviewWidth;
        webviewDimension.height = webviewHeight;
        viewportDimension.width = viewportWidth;
        viewportDimension.height = viewportHeight;
        bridge.executeNativeCall('visxSetPlacementEffect', 'effect', effect, 'webviewWidth', webviewWidth, 'webviewHeight', webviewHeight, 'viewportWidth', viewportWidth, 'viewportHeight', viewportHeight);
    };
    
    mraid.visxGetPlacementEffect = function() {
        console.log("visxGetPlacementEffect = "+placementEffect);
        return placementEffect;
    };
    
    mraid.visxGetPlacementDimension = function() {
        console.log("webviewDimension: " + webviewDimension.width + ", " + webviewDimension.height);
        console.log("viewportDimension: " + viewportDimension.width + ", " + viewportDimension.height);
        return {
        webviewDimension: {
        width: webviewDimension.width,
        height: webviewDimension.height
        },
        viewportDimension: {
        width: viewportDimension.width,
        height: viewportDimension.height
        }
        }
    };
    
    mraid.visxClosePlacement = function() {
        console.log("called visxClosePlacement")
        bridge.executeNativeCall('visxClosePlacement')
    };
    
    mraid.visxClearPlacement = function() {
        console.log("called visxClearPlacement")
        bridge.executeNativeCall('visxClearPlacement')
    };
    
    mraid.visxRefreshPlacement = function() {
        console.log("called visxRefreshPlacement")
        bridge.executeNativeCall('visxRefreshPlacement')
    };
    
    mraid.visxVideoFinished = function() {
        console.log("called visxVideoFinished");
        bridge.executeNativeCall('visxVideoFinished');
    };
    
    mraid.visxVideoWasCanceled = function() {
        console.log("called visxVideoWasCanceled");
        bridge.executeNativeCall('visxVideoWasCanceled');
    };
    
    mraid.visxVideoWasMuted = function() {
        console.log("called visxVideoWasMuted");
        bridge.executeNativeCall('visxVideoWasMuted');
    };
    
    mraid.visxVideoWasUnmuted = function() {
        console.log("called visxVideoWasUnmuted");
        bridge.executeNativeCall('visxVideoWasUnmuted');
    };

    mraid.setDeviceVolume = function (volume) {
        console.log("device volume setDeviceVolume="+volume);
        if (volume < 0 || volume > 1) {
            broadcastEvent(EVENTS.ERROR, 'volume is required.', 'open');
        } else {
            bridge.executeNativeCall('setDeviceVolume', 'volume', volume);
        }
    };
    
    mraid.open = function (URL) {
        if (!URL) {
            broadcastEvent(EVENTS.ERROR, 'URL is required.', 'open');
        } else {
            console.log("mraid.open func for opening new URL: " + URL);
            bridge.executeNativeCall('open', 'url', URL);
        }
    };
    
    mraid.removeEventListener = function (event, listener) {
        
        if (!event) {
            broadcastEvent(EVENTS.ERROR, 'Event is required.', 'removeEventListener');
            return;
        }
        
        if (listener) {
            // If we have a valid event, we'll try to remove the listener from it.
            var success = false;
            if (listeners[event]) {
                success = listeners[event].remove(listener);
            }
            
            // If we didn't have a valid event or couldn't remove the listener from the event, broadcast an error and return early.
            if (!success) {
                broadcastEvent(EVENTS.ERROR, 'Listener not currently registered for event.', 'removeEventListener');
                return;
            }
            
        } else if (!listener && listeners[event]) {
            listeners[event].removeAll();
        }
        
        if (listeners[event] && listeners[event].count === 0) {
            listeners[event] = null;
            delete listeners[event];
        }
    };
    mraid.setExpandProperties = function (properties) {
        if (validate(properties, expandPropertyValidators, 'setExpandProperties', true)) {
            if (properties.hasOwnProperty('width') || properties.hasOwnProperty('height')) {
                hasSetCustomSize = true;
            }
            if (properties.hasOwnProperty('useCustomClose')) hasSetCustomClose = true;
            var desiredProperties = ['width', 'height', 'useCustomClose', 'expandPosition'];
            var length = desiredProperties.length;
            for (var i = 0; i < length; i++) {
                var propname = desiredProperties[i];
                if (properties.hasOwnProperty(propname)) expandProperties[propname] = properties[propname];
            }
        }
    };
    mraid.setOrientationProperties = function (properties) {
        
        if (validate(properties, orientationPropertyValidators, 'setOrientationProperties', true)) {
            var desiredProperties = ['allowOrientationChange', 'forceOrientation'];
            var length = desiredProperties.length;
            for (var i = 0; i < length; i++) {
                var propname = desiredProperties[i];
                if (properties.hasOwnProperty(propname)) {
                    orientationProperties[propname] = properties[propname];
                }
            }
        }
        
        var args = ['setorientationproperties'];
        args = args.concat(['allowOrientationChange', orientationProperties.allowOrientationChange]);
        args = args.concat(['forceOrientation', orientationProperties.forceOrientation]);
        
        bridge.executeNativeCall.apply(this, args);
    };
    mraid.setModalVCProperties = function (properties) {
        if (validate(properties, modalVCPropertyValidators, 'setModalVCProperties', true)) {
            var desiredProperties = ['alpha', 'backgroundColor', 'isMraid', 'transitionStyle'];
            var length = desiredProperties.length;
            for (var i = 0; i < length; i++) {
                var propname = desiredProperties[i];
                if (properties.hasOwnProperty(propname)) { // (propname + " - " + modalVCProperties[propname]);
                    modalVCProperties[propname] = properties[propname];
                }
            }
        }
    };
    mraid.setResizeProperties = function (properties) {
        if (validate(properties, resizePropertyValidators, 'setResizeProperties', true)) {
            var desiredProperties = ['width', 'height', 'offsetX', 'offsetY', 'customClosePosition', 'allowOffscreen'];
            var length = desiredProperties.length;
            for (var i = 0; i < length; i++) {
                var propname = desiredProperties[i];
                if (properties.hasOwnProperty(propname)) resizeProperties[propname] = properties[propname];
            }
        }
    };
    mraid.useCustomClose = function (shouldUseCustomClose) {
        expandProperties.useCustomClose = shouldUseCustomClose;
        hasSetCustomClose = true;
        console.log("Will execute bridge.executeNativeCall useCustomClose");
        bridge.executeNativeCall('usecustomclose', 'shouldUseCustomClose', shouldUseCustomClose);
    };
    mraid.setCustomCloseButtonParams = function (imageURLForCustomCloseButton, width, height) {
        bridge.executeNativeCall('setcustomclosebuttonparams', 'url', imageURLForCustomCloseButton, '<<width', width,'<<height', height);
    };
    mraid.forceOrientation = function (orientation) {
        bridge.executeNativeCall('forceorientation', 'orientation', orientation);
    };
    mraid.exitApplicationAlert = function (alertFlag, alertTextData) {
        var args = ['setExitApplicationAlert'];
        args = args.concat(['alert', alertFlag]);
        for (obj in alertTextData) {
            args = args.concat([obj, encodeURIComponent(alertTextData[obj])]);
        }
        console.log("will execute nativeCall for exitApplicationAlert");
        bridge.executeNativeCall.apply(this, args);
    };
    mraid.setCloseButtonPosition = function (value) {
        if (value != "top-right" && value != "top-left" && value != "bottom-right" && value != "bottom-left") {
            value = "top-right";
        }
        console.log("will executeNativeCall of setCloseButtonPosition="+value);
        bridge.executeNativeCall('setCloseButtonPosition', 'position', value);
    };
    mraid.setDimmingViewProperties = function (color, alpha) {
        bridge.executeNativeCall('setDimmingViewProperties', 'color', color, 'alpha', alpha);
    };
}());