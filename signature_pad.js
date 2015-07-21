(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module unless amdModuleId is set
    define([], function () {
      return (root['SignaturePad'] = factory());
    });
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    root['SignaturePad'] = factory();
  }
}(this, function () {

/*!
 * Signature Pad v1.4.0
 * https://github.com/szimek/signature_pad
 *
 * Copyright 2015 Szymon Nowak
 * Released under the MIT license
 *
 * The main idea and some parts of the code (e.g. drawing variable width Bézier curve) are taken from:
 * http://corner.squareup.com/2012/07/smoother-signatures.html
 *
 * Implementation of interpolation using cubic Bézier curves is taken from:
 * http://benknowscode.wordpress.com/2012/09/14/path-interpolation-using-cubic-bezier-and-control-point-estimation-in-javascript
 *
 * Algorithm for approximated length of a Bézier curve is taken from:
 * http://www.lemoda.net/maths/bezier-length/index.html
 *
 */
var SignaturePad = (function (document) {
    "use strict";

    var SignaturePad = function (canvas, options) {
        var self = this,
            opts = options || {};

        this.velocityFilterWeight = opts.velocityFilterWeight || 0.7;
        this.minWidth = opts.minWidth || 0.5;
        this.maxWidth = opts.maxWidth || 2.5;
        this.cpTension = opts.cpTension || 0.5;
        this.curveOrder = opts.curveOrder || 3;
        if (this.curveOrder <2 || this.curveOrder > 4) {
            throw Error('Invalid curveOrder'+this.curveOrder);
        }
        this.throttle = opts.throttle || 16;
        this.dotSize = opts.dotSize || function () {
            return (this.minWidth + this.maxWidth) / 2;
        };
        this.penColor = opts.penColor || "black";
        this.backgroundColor = opts.backgroundColor || "rgba(0,0,0,0)";
        this.onEnd = opts.onEnd;
        this.onBegin = opts.onBegin;

        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");
        this._ctx.lineCap = 'round';
        this._ctx.lineJoin = 'round';
        this.clear();
        this._canvasWidthScale = null;
        this._canvasHeightScale = null;

        // we need add these inline so they are available to unbind while still having
        //  access to 'self' we could use _.bind but it's not worth adding a dependency
        this._handleMouseDown = function (event) {
            if (event.which === 1) {
                self._mouseButtonDown = true;
                self._strokeBegin(event);
            }
        };

        this._handleMouseMove = function (event) {
            if (self._mouseButtonDown) {
                self._strokeUpdate(event);
            }
        };

        this._handleMouseUp = function (event) {
            if (event.which === 1 && self._mouseButtonDown) {
                self._mouseButtonDown = false;
                self._strokeEnd(event);
            }
        };

        this._handleTouchStart = function (event) {
            var touch = event.changedTouches[0];
            self._strokeBegin(touch);
        };

        this._handleTouchMove = function (event) {
            // Prevent scrolling.
            event.preventDefault();

            var touch = event.changedTouches[0];
            self._strokeUpdate(touch);
        };

        this._handleTouchEnd = function (event) {
            var wasCanvasTouched = event.target === self._canvas;
            if (wasCanvasTouched) {
                self._strokeEnd(event);
            }
        };

        this._handleMouseEvents();
        this._handleTouchEvents();
    };

    SignaturePad.prototype.clear = function () {
        var ctx = this._ctx,
            canvas = this._canvas;

        ctx.fillStyle = this.backgroundColor;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        this._reset();
    };

    SignaturePad.prototype.toDataURL = function (imageType, quality) {
        var canvas = this._canvas;
        return canvas.toDataURL.apply(canvas, arguments);
    };

    SignaturePad.prototype.fromDataURL = function (dataUrl) {
        var self = this,
            image = new Image(),
            ratio = window.devicePixelRatio || 1,
            width = this._canvas.width / ratio,
            height = this._canvas.height / ratio;

        this._reset();
        image.src = dataUrl;
        image.onload = function () {
            self._ctx.drawImage(image, 0, 0, width, height);
        };
        this._isEmpty = false;
    };

    SignaturePad.prototype._strokeUpdate = function (event) {
        var point = this._createPoint(event);
        this._addPoint(point);
    };

    SignaturePad.prototype._strokeBegin = function (event) {
        this._reset();
        this._strokeUpdate(event);
        if (typeof this.onBegin === 'function') {
            this.onBegin(event);
        }
    };

    SignaturePad.prototype._strokeDraw = function (point) {
        var ctx = this._ctx,
            dotSize = typeof(this.dotSize) === 'function' ? this.dotSize() : this.dotSize;

        ctx.beginPath();
        this._drawPoint(point.x, point.y, dotSize);
        ctx.closePath();
        ctx.fill();
    };

    SignaturePad.prototype._strokeEnd = function (event) {
        var canDrawCurve = this.points.length > 2,
            point = this.points[0];

        if (!canDrawCurve && point) {
            this._strokeDraw(point);
        }
        if (typeof this.onEnd === 'function') {
            this.onEnd(event);
        }
    };

    SignaturePad.prototype._handleMouseEvents = function () {
        var self = this;
        this._mouseButtonDown = false;

        this._canvas.addEventListener("mousedown", this._handleMouseDown);
        this._canvas.addEventListener("mousemove", this._handleMouseMove);
        document.addEventListener("mouseup", this._handleMouseUp);
    };

    SignaturePad.prototype._handleTouchEvents = function () {
        var self = this;

        // Pass touch events to canvas element on mobile IE.
        this._canvas.style.msTouchAction = 'none';

        this._canvas.addEventListener("touchstart", this._handleTouchStart);
        this._canvas.addEventListener("touchmove", this._handleTouchMove);
        document.addEventListener("touchend", this._handleTouchEnd);
    };

    SignaturePad.prototype.off = function () {
        this._canvas.removeEventListener("mousedown", this._handleMouseDown);
        this._canvas.removeEventListener("mousemove", this._handleMouseMove);
        document.removeEventListener("mouseup", this._handleMouseUp);

        this._canvas.removeEventListener("touchstart", this._handleTouchStart);
        this._canvas.removeEventListener("touchmove", this._handleTouchMove);
        document.removeEventListener("touchend", this._handleTouchEnd);
    };

    SignaturePad.prototype.isEmpty = function () {
        return this._isEmpty;
    };

    SignaturePad.prototype._reset = function () {
        this.points = [];
        this._lastVelocity = 0;
        this._lastWidth = (this.minWidth + this.maxWidth) / 2;
        this._isEmpty = true;
        this._ctx.fillStyle = this.penColor;
        this._ctx.strokeStyle = this.penColor;
    };

    SignaturePad.prototype._getCanvasWidthScale = function () {
        if (!this._canvasWidthScale) {
            this._canvasWidthScale = this._canvas.clientWidth / this._canvas.width;
        }
        return this._canvasWidthScale;
    };

    SignaturePad.prototype._getCanvasHeightScale = function () {
        if (!this._canvasHeightScale) {
            this._canvasHeightScale = this._canvas.clientHeight / this._canvas.height;
        }
        return this._canvasHeightScale;
    };

    SignaturePad.prototype._createPoint = function (event) {
        var rect = this._canvas.getBoundingClientRect();
        return new Point(
            (event.clientX - rect.left) / this._getCanvasWidthScale(),
            (event.clientY - rect.top) / this._getCanvasHeightScale()
        );
    };

    SignaturePad.prototype._throttle = function (point) {
        var lastPoint = this.points[this.points.length-1];
        if (lastPoint &&
            lastPoint.sqrDistanceTo(point) < this.throttle) {
            return false;
        } else {
            return true;
        }
    };

    SignaturePad.prototype._addPoint = function (point) {
        var points = this.points,
            c2, c3,
            curve, tmp;

        if (!this._throttle(point)) {
            return;
        }

        points.push(point);

        // To reduce the initial lag make it work with fewer points
        // by copying the first point to the beginning.
        while (points.length < this.curveOrder) {
            points.unshift(points[0]);
        }

        if (this.curveOrder === 2) {
            curve = new Bezier(points[0], undefined, undefined, points[1]);
        } else if (this.curveOrder === 3) {
            c2 = new Point((points[0].x + points[1].x)/2.0, (points[0].y+points[1].y)/2.0);
            c3 = new Point((points[1].x + points[2].x)/2.0, (points[1].y+points[2].y)/2.0);
            curve = new Bezier(c2, points[1], undefined, c3);
        } else if (this.curveOrder === 4) {
            tmp = this._calculateCurveControlPoints(points[0], points[1], points[2]);
            c2 = tmp.c2;
            tmp = this._calculateCurveControlPoints(points[1], points[2], points[3]);
            c3 = tmp.c1;
            curve = new Bezier(points[1], c2, c3, points[2]);
        }


        this._addCurve(curve);

        // Remove the first element from the list,
        // so that we always have no more than `this.curveOrder` points in points array.
        points.shift();
    };

    SignaturePad.prototype._calculateCurveControlPoints = function (s1, s2, s3) {
        var t = 0.5;
        var d01 = s1.distanceTo(s2);
        var d12 = s2.distanceTo(s3);
        var fa=t*d01/(d01+d12);   // scaling factor for triangle Ta
        var fb=t*d12/(d01+d12);   // ditto for Tb, simplifies to fb=t-fa

        return {
            c1: new Point(s2.x-fa*(s3.x-s1.x), s2.y-fa*(s3.y-s1.y)),
            c2: new Point(s2.x+fb*(s3.x-s1.x), s2.y+fb*(s3.y-s1.y))
        };
    };

    SignaturePad.prototype._addCurve = function (curve) {
        var startPoint = curve.startPoint,
            endPoint = curve.endPoint,
            velocity, newWidth;

        if (this.maxWidth !== this.minWidth) {
            velocity = endPoint.velocityFrom(startPoint);
            velocity = this.velocityFilterWeight * velocity
                + (1 - this.velocityFilterWeight) * this._lastVelocity;

            newWidth = this._strokeWidth(velocity);
            this._drawCurve(curve, this._lastWidth, newWidth);

            this._lastVelocity = velocity;
            this._lastWidth = newWidth;
        } else {
            this._drawCurve(curve, this._lastWidth, this._lastWidth);
        }
    };

    SignaturePad.prototype._drawPoint = function (x, y, size) {
        var ctx = this._ctx;

        ctx.moveTo(x, y);
        ctx.arc(x, y, size/2.0, 0, 2 * Math.PI, false);
        this._isEmpty = false;
    };

    SignaturePad.prototype._drawCurve = function (curve, startWidth, endWidth) {
        var ctx = this._ctx;

        ctx.beginPath();

        ctx.moveTo(curve.startPoint.x, curve.startPoint.y);
        if (curve.control1 && curve.control2) {
            ctx.bezierCurveTo(curve.control1.x, curve.control1.y, curve.control2.x, curve.control2.y, curve.endPoint.x, curve.endPoint.y);
        } else if (curve.control1) {
            ctx.quadraticCurveTo(curve.control1.x, curve.control1.y, curve.endPoint.x, curve.endPoint.y);
        } else {
            ctx.lineTo(curve.endPoint.x, curve.endPoint.y);
        }

        ctx.lineWidth = endWidth;
        ctx.stroke();
    };

    SignaturePad.prototype._strokeWidth = function (velocity) {
        return Math.max(this.maxWidth / (velocity + 1), this.minWidth);
    };


    var Point = function (x, y, time) {
        this.x = x;
        this.y = y;
        this.time = time || new Date().getTime();
    };

    Point.prototype.velocityFrom = function (start) {
        return (this.time !== start.time) ? this.distanceTo(start) / (this.time - start.time) : 1;
    };

    Point.prototype.distanceTo = function (start) {
        return Math.sqrt(this.sqrDistanceTo(start));
    };

    Point.prototype.sqrDistanceTo = function (start) {
        return Math.pow(this.x - start.x, 2) + Math.pow(this.y - start.y, 2);
    };

    var Bezier = function (startPoint, control1, control2, endPoint) {
        this.startPoint = startPoint;
        this.control1 = control1;
        this.control2 = control2;
        this.endPoint = endPoint;
    };

    return SignaturePad;
})(document);

return SignaturePad;

}));
