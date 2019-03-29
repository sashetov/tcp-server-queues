'use strict'
var btoa = require("btoa");
var sha256 = require("js-sha256");
var utf8 = require("utf8");
var net = require('net');
/** Queue - basic queue implemented as internally via js array
 *  allows enqueue, next and getQueueLength operations */
class Queue {
  /** constructor - for Queue */
  constructor() {
    this.store = []; // internally uses js array
  }
  /** enqueue - adds an item to the queue
   * @param {Object} o - an object to be enqueued
   */
  enqueue(o) { // expects object be passed to it
    this.store.push(o);
  }
  /** next - gets the next item from the fifo or throws an error
   * @return {Object} - the next item
   */
  next() {
    var item=this.store.shift();
    if(item == undefined)
      throw new Error('Ran out');
    return item;
  }
  /** getLength - gets the length of the queue 
   * @return {Number} - the length of the queue
   */
  getLength(){
    return this.store.length;
  }
}
/** MessageService - message service implementation allowing a single input
 * queue and multiple ( amount specified by numOut ) possible output queues,
 * the dispatch to which is handled by a passed routingFn, and input item
 * transformation handled by the transformFn passed to the constructor
 * */
class MessageService{
  /** constructor for MessageService
   * @param {Number} numOut - number of output queues
   * @param {function} transformFn - does work to transform input into
   * output items
   * @param routingFn - function that, given a transformed item, will return 
   * the an out queue index that the item belongs to
   * */
  constructor(numOut, transformFn, routingFn){
    this.inQueue = new Queue(); // only untransformed items enqueued here
    this.transfQueue= new Queue(); // only transformed items enqueued here
    this.outQueues = [ ]; // end queues where transformed items are dispatched
    this.transformFn = transformFn; // applied to each msg to transform it
    this.routingFn = routingFn;     // used to dispatch to correct out queue
    this.debug = false; // enable to enable debug printing
    for( var i =0; i< numOut; i++){
      this.outQueues[i] = new Queue();
    }
  }
  /** debugPrint - prints out debug messages whenever this.debug is enabled 
   * in the constructor, for developer use only
   */
  debugPrint(){
    if(this.debug){ 
      console.log.apply(this,arguments);
    }
  }
  /** dispatchOne - takes a single next item from this.transfQueue and adds
   * it to the appropriate out queue that it belongs to, using the routing
   * function supplied to the constructor.*/
  dispatchOne(){
    var out = this.transfQueue.next();
    var outN = this.routingFn(out);
    if( outN <0 || outN > this.outQueues.length -1 )
      this.outQueues[outN].enqueue(out);
  }
  /** dispatchAll - iterates the entire transfQueue and dispatches item by item
   * until it has run through the whole transfQueue
   */
  dispatchAll(){
    for(var i=0; i< this.transfQueue.getLength(); i++){
      this.dispatchOne();
    }
  }
  /** transformAndDipatchAll - transforms a next single item, adds it to
   * transfQueue and then runs this.dispatchAll to attempt to dispatch
   * this item and any other remaining possible next items that were not 
   * previously dispatched
   */
  transformAndDipatchAll(){
    var out = this.transformFn(this.inQueue.next());
    this.transfQueue.enqueue(out);// enqueue one item FIFO after transformation
    this.dispatchAll(); // attempt to route all in transformed queue into
    this.debugPrint(this.outQueues);//appropriate out queue
  }
  /** enqueue - takes a JSON string, parses it to an Object, which it then 
   * enqueues in the "in" queue. After its there, it transforms it and runs
   * processes the items in the transfQueue via transformAndDipatchAll
   * @param {string} msg - single JSON string representing an Object
   * */
  enqueue (msg){
    this.inQueue.enqueue(JSON.parse(msg));
    this.transformAndDipatchAll(); // transform one enqueued item and 
    // run dispatch on all in transformed queue
  }
  /** next - gets the next item from a specified out queue
   * @param  {Number} N - out queue channel id for which to get next item
   * @return {string} JSON representation of the next item in the queue 
   * specified by N
   */
  next(N) {
    this.dispatchAll(); // attempt to route all in transformed queue into
    if( N<0 || N > this.outQueues.length-1) // bounds check
      throw new Error("Bad next route number");
    this.debugPrint(this.outQueues);
    return JSON.stringify(this.outQueues[N].next());//return string represent
  }
  /** getLengthOutQueue - gets the length of a specified out queue
   * @param {Number} n - the id for the out queue
   * @return {Number} - the length of the out queue
   */
  getLengthOutQueue(n){
    return this.outQueues[n].getLength();
  }
}
/** SequentialMessageService - a message service implementation which
 * has the same functionality of MessageService, but in addition supports
 * messages that are sequential ( partitioned messages )
 */
class SequentialMessageService extends MessageService {
  /** constructor - constructor for SequentialMessageService, includes
   * extra code to handle sequential indexes and to ensure correct routing
   * after first element is routed
   * @param {Number} numOut - number of output queues
   * @param {function} transformFn - does work to transform input into
   * output items
   * @param routingFn - function that, given a transformed item, will return 
   * the an out queue index that the item belongs to
   * */
  constructor(numOut,transformFn,routingFn){
    super(numOut,transformFn,routingFn); // call parent constructor
    this.seqOutIndex={}; // maps seqId's to last out index processed
    this.seqOutRoute={}; // maps seqId's to first route for 0 item in seq
  }
  /** routeItem- helper function to route ( enqueue ) an item to its
   * correct out queue. (Used by dispatchOne.)  This function checks sequence
   * for the presense of sequence id's and maintains correct route id
   * state per sequence id
   * @param {Object} item - a single (transformed) item that is to be routed
   */
  routeItem(item){
    var outN, // used to store the correct out route number
        seqId = item['_sequence']; // used to store sequence id
    if(!seqId){ // no sequence in general
      outN = this.routingFn(item); // get dispatch route, but don't store
    }
    else if(this.seqOutRoute[seqId]==undefined){ //first item in seq
      this.seqOutRoute[seqId]= this.routingFn(item); // get dispatch route
      outN = this.seqOutRoute[seqId]; //set outN
    }
    else { // not first item in seq
      outN = this.seqOutRoute[seqId]; // set outN
    }
    if( outN <0 || outN > this.outQueues.length -1 ) //bounds check
      throw new Error("Bad dispatch route number");
    this.outQueues[outN].enqueue(item); // enqueue in correct out queue
  }
  /** dispatchOne - takes a single next item from this.transfQueue and adds
   * it to the appropriate out queue that it belongs to, using the routing
   * function supplied to the constructor.
   * Includes code to check that correct sequence id's are provided
   * before allowing a dispatch to the correct out queue.
   * Includes code to enqueue items with incorrect next sequence id's back
   * into the transfQueue, so that they don't get lost
   * */
  dispatchOne(){
    var out = this.transfQueue.next();
    var seqId = out['_sequence']; // temporary holder to track sequence id
    if(seqId !=undefined ){
      var seqN = out['_part'];
      if(!Number.isInteger(seqN))
        throw new Error("Sequence part is not int");
      //in the if below, check whether its a item in a sequence that is first
      //or exact next item to be routed to a out queue
      if( (this.seqOutIndex[seqId] == undefined && seqN ==0)|| //first item
        (this.seqOutIndex[seqId] != undefined && 
          seqN == (this.seqOutIndex[seqId]+1) )){// next in sequence
        this.seqOutIndex[seqId] =seqN;
        this.routeItem(out); // route the item
      }
      else{ // neither, enq back into transformed queue, to be processed later
        this.transfQueue.enqueue(out);
      }
    }
    else // no sequences to worry about, just route the thing
      this.routeItem(out);
  }
}
/** TcpServer - basic server implementation which binds to host and listens on
 * port for TCP connections and handles the input and output streams for 
 * the socket via socketHandler function */
class TcpServer {
  /** constructor - for TcpServer 
   * @param {string} host - a hostname (IP address) to bind to
   * @param {Number} port - a TCP port to listen on
   * @param {Function} socketHandler - a function that will be passed
   * a socket. The function should handle events emitted by the socket, hence
   * performing the work of the server
   * */
  constructor( host, port, socketHandler ){
    var self = this;
    this.host = host; // ip address, host to bind to
    this.port = port; // TCP port to listen on
    this.server = net.createServer(socketHandler); // stores a net.Server 
    //instance based on socketHandler
  }
  /** listen - calls this.server.listen with the port and host provided to the
   * constructor
   */
  listen(){
    this.server.listen(this.port,this.host);
  }
  /** close - closes server
   * @param {Function} cb - callback called on succesful close
   */
  close(cb){
    this.server.unref();//allows process to exit if only this server is in event system
    this.server.close(cb); // close the server, call cb on completion
  }
}
/** TcpClient - basic client implentation that connects to host:port and
 * is capable of sending a request and processing the response to that 
 * request */
class TcpClient {
  /** constructor - to TcpClient */
  constructor(host,port){
    this.host = host; // host/ip to connect to
    this.port = port; // port to connect to
  }
  /** send - send a request string data to the socket input stream provided
   * by the connection to host/port provided in constructor. Any successful
   * response is sent back by calling callback cb as second parameter.
   * Any error response is also sent via callback cb as first parameter.
   * @param {Object} data - an object to send to the stream
   * @param {Function} cb - a callback function to pass the response to
   */
  send(data,cb){
    const self = this;
    var client = new net.Socket();
    client.on('data', function(data){
      cb(null,data.toString()) // pass data as second param to callback
    });
    client.on('error',function(e){ cb(e); })
    client.connect(this.port, this.host, function(){
      if(typeof(data)=="object")
        data = JSON.stringify(data);
      try{
        this.write(data);
      } catch(e){
        cb(e); // pass the error as first param to callback function
      }
    });
  }
  /** close - closes the client connection */
  close(){
    this.client.end();
  }
}
/** MessageServiceClient - a type of client that sends 
 * MessageServiceHandlerSocket type requests for enqueue and 
 * next opertions specifically. Callbacks containing the responses are 
 * processed as Promises */
class MessageServiceClient extends TcpClient {
  /*constructor - for MessageServiceClient */
  constructor(host,port){
    super(host,port); // call parent constructor
  }
  /** enqueue - enqueues a stringified object into the server's in queue for 
   * processing
   * @param {String} data - the string representation of the item
   * @return {Promise} - a promise which will resolve to true if the enqueue
   * operation was successful and will be rejected if there's an error
   * */
  enqueue(data){
    return new Promise( (resolve,reject)=>{
      var actionObj = { "action" : "enqueue", "data": JSON.parse(data) };
      this.send(actionObj,(err,res)=>{
        if(err) reject(err);
        resolve(true);
      });
    });
  }
  /** next - asks the server for the next item in out queue specified by n
   * @param {Number} n - number of out queue to query an item for
   * @return {Promise} - a promise 
   */
  next(n){
    var actionObj={ "action" : "next", "channel": n };
    return new Promise( (resolve,reject)=>{
      this.send(actionObj,(err,res)=>{
        if(err) reject(err);
        resolve(res);
      })
    });
  }
}
/** MessageServiceSocketHandler - server side handling of MessageServer 
 * operations. Handles socket events with the data event specifically being 
 * the one the stream is serialized into JSON's and where each JSON is
 * processed as an action, and then these individual actions are implemented
 * via the service provided
 */
class MessageServiceSocketHandler{
  /** constructor - for MessageServiceSocketHandler */
  constructor( socket, service ){
    var self = this;
    this.service = service;
    /** enqueueResponder - "private" function that enqueues an item using
     * the service provided in the constructor and writes out
     * a successful response or throws an error, depending on whether a valid
     * request object is provided
     * @param {object} req - a enqueue request object
     */
    function enqueueResponder(req){
      if(req["data"]==undefined){
        throw new Error("invalid 'enqueue' action: no data provided");
      }
      self.service.enqueue(JSON.stringify(req.data)); // enqueue the item
      socket.write(JSON.stringify('{"_enqueued":true}')); // respond
    }
    /** nextResponder - "private" function that gets an next item from the 
     * out queue using service provided in constructor and writes out
     * a successful response or throws an error depending on whether a valid
     * request object is provided
     * @param {object} req - a enqueue request object
     */
    function nextResponder( req ){
      if(req["channel"]==undefined){
        throw new Error("invalid 'next' action: no channel provided");
      }
      socket.write(self.service.next(req.channel));
    }
    /** serve - "private" function used as callback to process requests written
     * to the client connection's output socket's stream ( that come in via \
     * "data" event ). Responses are written to the client connection's input
     * stream via Socket.write
     * @param {Buffer} requests - newline seperated lines of JSON strings in
     * Buffer-ed string data representing objects, written to the stream
     */
    function serve (requests){
      requests=requests.toString();//buffer to string
      var lines = requests.split("\n"); // split data into lines
      for (var i =0; i< lines.length; i++){
        var line = lines[i];
        if(!line) continue; // if empty line, skip to next thing
        try {
          var req = JSON.parse(line); // request object defined in each line
          if(req["action"]==undefined)
            throw new Error("No action provided, invalid request object");
          if(req.action =="enqueue") enqueueResponder(req);
          else if(req.action=="next") nextResponder(req);
          else throw new Error("Invalid action '"+req.action+
            "': no such action exists");
        }
        catch(e){
          console.log(e.stack);
        }
      }
    }
    // TODO: add more cases for the rest of the events
    // TODO: errors should be sent to the client instead of being thrown
    // by the server, currently client can crash server
    // the actual socket eventshandling:
    socket.on("error",function(error){ // handle error
      console.log("Socket error: \n"+error.stack);
    });
    socket.on("data",serve);
  }
}
/*MessageServiceServer - a class for starting up a TcpServer with
 * a MessageServeSocketHandler handler, using a MessageService of your choice
 * ( one that implements enqueue and next(n) ) as passed to the constructor */
class MessageServiceServer {
  /*constructor - for MessageServiceServer 
   * @param {MessageService} service - an instance of a MessageService
   * implementation
   * @param {string} hostname- a hostname (IP address) to bind to
   * @param {Number} port - a TCP port to listen on
   */
  constructor( service, hostname, port){
    var self=this;
    this.service= service;
    this.clients = []; // we keep all the client connection sockets here
    /** listener - private function that is called any time a client connects
     * to the port, creating a new socket. The listener adds the socket
     * to the clients registry and handles the input/output via a 
     * MessageServiceSocketHandler
     * @param {net.Socket} socket - socket created for connection
     */
    function listener(socket) {
      self.clients.push(socket); // add the current socket to the registry
      self.socketHandler=new MessageServiceSocketHandler(socket,self.service);
          //^ add a socket handler
    }
    this.server = new TcpServer(hostname,port,listener);// create the server
    this.server.listen(); // make it listen
  }
  /** close - destroys any existing client connections and then closes the 
   * server
   * @param {Function} cb - callback called on successful server close*/
  close(cb){
    for(var i=0;i<this.clients.length; i++){
      this.clients[i].destroy(); // destroy client connection
    }
    this.server.close(cb); // close server
  }
}
/** exampleTransform - actual transformation function implemenation used
 * to transform in items into out items for the example challenge, passed
 * to MessageService object constructors
 * transformation rules are:
 * - any field that starts with _ is skipped, except _hash, which is utf8 
 *   encoded, then base64 encoded, then sha256 summed and stored in 'hash'
 *   field ( newly created or overwritten if existing )
 * - any field value string containing "Example" is reversed
 * - any field value _integer_ is bitwise negated
 * @param {Object} msg - the object which to transform
 * @return {Object} - the transformed out object
 */
const exampleTransform = (msg) => {
  var out = msg;
  for( var key in out ){
    var val= out[key];
    if ( key[0] == '_' ){//any field in msg that starts with _ is passed
      if( key =='_hash'){// except _hash
        if(out[val] == undefined )
          throw new Error("Error: _hash value not a valid msg key");
        else {
          out.hash = sha256( // sha sum for base64 encoded value
            btoa( // base64 encodes
              utf8.encode(out[val]) //encode ucs-2 to utf-8
            )
          );
        }
      }
    }
    else {
      if(typeof(val)=='string' && val.match('Example') != null) //string values get reversed
        out[key]=val.split('').reverse().join('');
      else if(typeof(val)=='number' && Number.isInteger(val) ) 
        out[key]= ~ val; //int vals get bitwise negated
    }
  }
  return out;
}
/** exampleDispatch - actual dispatch function implementation used to get the
 * correct output queue number for the transformed objects, this function
 * is passed to MessageService object constructors.
 * Dispatch rules are:
 * - items containing _special key are sent to 0 queue
 * - items containing hash key are sent to 1 queue
 * - items values are only compared if keys are not starting with _
 *   - values of reversed strings ( contain "elpmaxE" ) are sent to queue 2
 *   - values that are integer values are sent to queue 3
 * - anything that doesn't match any of the above routes gets sent to queue 4
 *  @param {Object} out - an item to be sent to an out queue
 *  @return {Number} - the correct out queue index for this item
 */
const exampleDispatch = (out) => {
  if( out['_special'] != undefined )
    return 0; //out._special exists - output queue 0
  else {
    if( out['hash'] != undefined )
      return 1; //out.hash exists - output queue 1
    else {
      for( var key in out ){
        var val = out[key];
        if(key[0] == '_') continue; //ignore *values* of out._keys fields
        if(typeof(val)=='string' && val.match('elpmaxE') != null) 
          return 2;//out contains string value containing 'elpmaxE',out queue2
        else if(typeof(val)=='number' && Number.isInteger(val) ) 
          return 3;//- out contains integer value, output queue 3
      }
      return 4; // if none of the valid keys are non reversable strings or ints: queue 4
    }
  }
}
const nOutQ = 5; // number of out queues for example dispatching
const getMessageService = () => {
  return new SequentialMessageService(nOutQ, exampleTransform, exampleDispatch);
}
const getMessageServiceServer = (hostname, port) => {
  var service = new SequentialMessageService(
    nOutQ, exampleTransform, exampleDispatch);
  return new MessageServiceServer(service,hostname,port)
}
const getMessageServiceClient = (host,port)=>{
  return new MessageServiceClient( host, port );
};
module.exports = {
  getMessageService : getMessageService,
  getMessageServiceServer : getMessageServiceServer,
  getMessageServiceClient : getMessageServiceClient
}
