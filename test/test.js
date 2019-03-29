const solution = require('../tcpqueueserver.js')
const btoa = require("btoa");
const sha256 = require("js-sha256");
const utf8=require("utf8");
const assert = require('assert');
const hostname = '127.0.0.1'
const port = 9999;
function getService() {
  return solution.getMessageService();
}
function getServiceServer(hostname,port){
  return solution.getMessageServiceServer(hostname,port);
}
function getServiceClient(hostname,port){
  return solution.getMessageServiceClient(hostname,port);
}
describe('Example Transformation/Dispatching Tests', function() {
  it('_special case',function(){
    const svc = getService();
    svc.enqueue('{ "_special": "nonempty", "int_value": 512, "str":"234asdf", "_hash":"str", "_other":"misc" }');
    const returned = JSON.parse(svc.next(0));
    assert.equal(returned['_special'], "nonempty");
  });
  it('IntegerNegation case',function(){
    const svc = getService();
    svc.enqueue('{"test": "message", "int_value": 512}');
    const returned = JSON.parse(svc.next(3));
    assert.equal(returned["int_value"] ,-513);
  });
  it('Reversible string case',function(){
    const svc = getService();
    svc.enqueue('{"test": "message Example"}');
    const returned = JSON.parse(svc.next(2));
    assert.equal(returned["test"] ,"elpmaxE egassem");
  });
  it('Non-reversible string case',function(){
    const svc = getService();
    svc.enqueue('{"test": "message"}');
    const returned = JSON.parse(svc.next(4));
    assert.equal(returned["test"] ,"message");
  });
  it('_hash case',function(){
    const svc = getService()
    var ucs2str = '\uD800\uDC01\xA9\uD800\uDC00\uD803\uDE6D';//'\uDA4D\uDAB4';
    //             \uD800\uDC0
    //             http://codepoints.net/U+10001 
    //                          \xA9 COPYRIGHT SIGN 
    //                          https://www.npmjs.com/package/utf8
    //                                    \uD800\uDC00\uD803\uDE6D
    //                                    valid UTF-16 surrogate pairs that 
    //                                    are utf-8 convertible
    //                                    https://unicodebook.readthedocs.io/unicode_encodings.html#ucs-2-ucs-4-utf-16-and-utf-32
    //                                                          \uDA4D\uDAB4 -an
    //                                                          invalid one 
    //                                                          (has nonscalar 
    //                                                          surrogate)
    var o = {
      "test": "some string to not reverse",
      "str": ucs2str,
      "int_value": 512,
      "_hash":"str"
    };
    var jsons=JSON.stringify(o);//converts strings to ucs2 according to ES
    svc.enqueue(jsons)
    const returned = JSON.parse(svc.next(1))
    assert.equal(returned["hash"] ,sha256(btoa(utf8.encode(ucs2str))));
  });
  it('mixed case with _sequence', function(){
    const svc = getService()
    var returned;
    var ucs2str = '\uD800\uDC01\xA9\uD800\uDC00\uD803\uDE6D';//'\uDA4D\uDAB4';
    var objects=[
      { "_special": "nonempty",
        "int_value": 512, 
        "str":"234asdf", 
        "_hash":"str" },            // route to 0 as special
      {"_sequence":"seqid_0", "_part":5,
        "test":"non reverse 5"},    // route to NOTHING, since missing _part 4
      {"_sequence":"seqid_0", "_part":3,
        "test":"non reverse 3"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":2,
        "test":"non reverse 2"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":0,
        "test":"reverse Example",
        "intcase": 64},             // route to 2  -reversible string
      {"_sequence":"seqid_0", "_part":1,
        "test":"non reverse 1"},    // route to 2 since 0 part is such
      {"test": "message Example"},    // route to 2 as reversible nonseq
      {"test": "message",
        "int_value": 512},           // route to 3 as integer
      {"test": "message"},           // route to 4 as nonreversable string
      { "test": "not reverse",
        "str": ucs2str,
        "int_value": 512,
        "_hash":"str" }              // route to 1 as hash
    ];
    for (var i =0; i < objects.length; i++){ // length -1 due to NOWHERE case
      var curJson = JSON.stringify(objects[i]);
      svc.enqueue(curJson);
    }
    returned=(JSON.parse(svc.next(0)));
    assert.equal(returned['_special'],"nonempty");
    returned=(JSON.parse(svc.next(1)));
    assert.equal(returned["hash"] ,sha256(btoa(utf8.encode(ucs2str))));
    returned=(JSON.parse(svc.next(2)));
    assert.equal(returned['test'],"elpmaxE esrever");
    returned=(JSON.parse(svc.next(2)));
    assert.equal(returned['test'],"non reverse 1");
    returned=(JSON.parse(svc.next(2)));
    assert.equal(returned['test'],"non reverse 2");
    returned=(JSON.parse(svc.next(2)));
    assert.equal(returned['test'],"elpmaxE egassem");
    returned=(JSON.parse(svc.next(2)));
    assert.equal(returned['test'],"non reverse 3");
    returned=(JSON.parse(svc.next(3)));
    assert.equal(returned['int_value'],-513);
    returned=(JSON.parse(svc.next(4)));
    assert.equal(returned['test'],"message");
  });
});
describe('Example TCP Server/Client Tests', function(){
  it('_special case client+server',function(done){
    const server= getServiceServer(hostname,port);
    const client = getServiceClient(hostname,port);
    client.enqueue('{ "_special": "nonempty", "int_value": 512, "str":"234asdf", "_hash":"str", "_other":"misc" }')
      .then((res)=>{
        client.next(0).then((res)=>{
          res = JSON.parse(res);
          assert.equal(res['_special'], "nonempty");
          server.close(done); // close server
        },
          (err)=>{
            assert.equal(!err,true);
            server.close(done); // close server
          });
      },
        (err)=>{
          assert.equal(!err,true);
          server.close(done); // close server
        });
  });
  it('IntegerNegation case - client+server',function(done){
    const server= getServiceServer(hostname,port);
    const client = getServiceClient(hostname,port);
    client.enqueue('{"test": "message", "int_value": 512}')
      .then((res)=>{
        client.next(3).then((res)=>{
          res = JSON.parse(res);
          assert.equal(res['int_value'], -513);
          server.close(done); // close server
        },
          (err)=>{
            assert.equal(!err,true);
            server.close(done); // close server
          });
      },
        (err)=>{
          assert.equal(!err,true);
          server.close(done); // close server
        });
  });
  it('Reversible string case - client+server',function(done){
    const server= getServiceServer(hostname,port);
    const client = getServiceClient(hostname,port);
    client.enqueue('{"test": "message Example"}')
      .then((res)=>{
        client.next(2).then((res)=>{
          res = JSON.parse(res);
          assert.equal(res['test'], "elpmaxE egassem");
          server.close(done); // close server
        },
          (err)=>{
            assert.equal(!err,true);
            server.close(done); // close server
          });
      },
        (err)=>{
          assert.equal(!err,true);
          server.close(done); // close server
        });
  });
  it('Non-Reversible string case - client+server',function(done){
    const server= getServiceServer(hostname,port);
    const client = getServiceClient(hostname,port);
    client.enqueue('{"test": "message"}')
      .then((res)=>{
        client.next(4).then((res)=>{
          res = JSON.parse(res);
          assert.equal(res['test'], "message");
          server.close(done); // close server
        },
          (err)=>{
            assert.equal(!err,true);
            server.close(done); // close server
          });
      },
        (err)=>{
          assert.equal(!err,true);
          server.close(done); // close server
        });
  });
  it('_hash case - client+server',function(done){
    const server= getServiceServer(hostname,port);
    const client = getServiceClient(hostname,port);
    var ucs2str = '\uD800\uDC01\xA9\uD800\uDC00\uD803\uDE6D';
    var o = {
      "test": "some string to not reverse",
      "str": ucs2str,
      "int_value": 512,
      "_hash":"str"
    };
    var jsons=JSON.stringify(o);//converts strings to ucs2 according to ES
    client.enqueue(jsons)
      .then((res)=>{
        client.next(1).then((res)=>{
          res = JSON.parse(res);
          assert.equal(res["hash"] ,sha256(btoa(utf8.encode(ucs2str))));
          server.close(done); // close server
        },
          (err)=>{
            assert.equal(!err,true);
            server.close(done); // close server
          });
      },
        (err)=>{
          assert.equal(!err,true);
          server.close(done); // close server
        });
  });
});
describe('Example Async Tests', function(){
  it('mixed case with _sequence, async', function(){
    const svc = getService()
    var returned;
    var ucs2str = '\uD800\uDC01\xA9\uD800\uDC00\uD803\uDE6D';//'\uDA4D\uDAB4';
    var objects=[
      { "_special": "nonempty",
        "int_value": 512, 
        "str":"234asdf", 
        "_hash":"str" },            // route to 0 as special
      {"_sequence":"seqid_0", "_part":5,
        "test":"non reverse 5"},    // route to NOTHING, since missing _part 4
      {"_sequence":"seqid_0", "_part":3,
        "test":"non reverse 3"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":2,
        "test":"non reverse 2"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":0,
        "test":"reverse Example",
        "intcase": 64},             // route to 2  -reversible string
      {"_sequence":"seqid_0", "_part":1,
        "test":"non reverse 1"},    // route to 2 since 0 part is such
      {"test": "message Example"},    // route to 2 as reversible nonseq
      {"test": "message",
        "int_value": 512},           // route to 3 as integer
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      {"test": "message"},           // route to 4 as nonreversable string
      { "test": "not reverse",
        "str": ucs2str,
        "int_value": 512,
        "_hash":"str" }              // route to 1 as hash
    ];
    var queued = []
    async function enqueueAll(){ // process asynchronously ( concurrent enqueues )
      for (var i =0; i < objects.length; i++){
        queued.push(await svc.enqueue(JSON.stringify(objects[i])));
      }
      return await Promise.all(queued);
    }
    const responses = enqueueAll();
    responses.then(function(vals){ // responses complete
      returned=(JSON.parse(svc.next(0)));
      assert.equal(returned['_special'],"nonempty");
      returned=(JSON.parse(svc.next(1)));
      assert.equal(returned["hash"] ,sha256(btoa(utf8.encode(ucs2str))));
      returned=(JSON.parse(svc.next(2)));
      assert.equal(returned['test'],"elpmaxE esrever");
      returned=(JSON.parse(svc.next(2)));
      assert.equal(returned['test'],"non reverse 1");
      returned=(JSON.parse(svc.next(2)));
      assert.equal(returned['test'],"non reverse 2");
      returned=(JSON.parse(svc.next(2)));
      assert.equal(returned['test'],"elpmaxE egassem");
      returned=(JSON.parse(svc.next(2)));
      assert.equal(returned['test'],"non reverse 3");
      returned=(JSON.parse(svc.next(3)));
      assert.equal(returned['int_value'],-513);
      returned=(JSON.parse(svc.next(4)));
      assert.equal(returned['test'],"message");
      const ql=svc.getLengthOutQueue(4);
      assert.equal(ql,66);
    });
  });
  it('mixed case with _sequence TCP Client+Server',function(done){
    const server= getServiceServer(hostname,port);
    var returned;
    var ucs2str = '\uD800\uDC01\xA9\uD800\uDC00\uD803\uDE6D';//'\uDA4D\uDAB4';
    var objects=[
      { "_special": "nonempty", "int_value": 512, "str":"234asdf", "_hash":"str" },            // route to 0 as special
      {"_sequence":"seqid_0", "_part":5, "test":"non reverse 5"},    // route to NOTHING, since missing _part 4
      {"_sequence":"seqid_0", "_part":3, "test":"non reverse 3"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":2, "test":"non reverse 2"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":0, "test":"reverse Example", "intcase": 64}, // route to 2  -reversible string
      {"_sequence":"seqid_0", "_part":1, "test":"non reverse 1"},    // route to 2 since 0 part is such
      {"test": "message Example"},   // route to 2 as reversible nonseq
      {"test": "message", "int_value": 512},          // route to 3 as integer
      {"test": "message"},          // route to 4 as nonreversable string
      { "test": "not reverse", "str": ucs2str, "int_value": 512, "_hash":"str" }             // route to 1 as hash
    ];
    var queued = []
    var client = getServiceClient(hostname,port);
    for (var i =0; i < objects.length; i++){
      queued.push(client.enqueue(JSON.stringify(objects[i])));
    }
    Promise.all(queued).then((vals)=>{ // responses complete
      var nexts=[
        client.next(0),
        client.next(2),
        client.next(2),
        client.next(2),
        client.next(2),
        client.next(2),
        client.next(3),
        client.next(4),
        client.next(1),
      ];
      return Promise.all(nexts);
    }, (err)=>{
      assert.equal(!err,true);
      server.close(done); // close server
    })
    .then((results)=>{
      results = results.map(JSON.parse); assert.equal(results[0]['_special'],"nonempty"); assert.equal(results[1]['test'],"elpmaxE esrever");
      assert.equal(results[2]['test'],"non reverse 1");
      assert.equal(results[3]['test'],"non reverse 2");
      assert.equal(results[4]['test'],"elpmaxE egassem");
      assert.equal(results[5]['test'],"non reverse 3");
      assert.equal(results[6]['int_value'],-513);
      assert.equal(results[7]['test'],"message");
      assert.equal(results[8]["hash"] ,sha256(btoa(utf8.encode(ucs2str))));
      server.close(done); // close server
    },
    (err)=>{
      console.log(err.stack);
      server.close(done); // close server
      assert.equal(!err,true);
    }).catch((e)=>{
      done(e);
    });
  });
  it('mixed case with _sequence TCP multiple Clients + single Server',function(done){
    const server= getServiceServer(hostname,port);
    var returned;
    var ucs2str = '\uD800\uDC01\xA9\uD800\uDC00\uD803\uDE6D';//'\uDA4D\uDAB4';
    var objects=[
      { "_special": "nonempty", "int_value": 512, "str":"234asdf", "_hash":"str" },            // route to 0 as special
      {"_sequence":"seqid_0", "_part":5, "test":"non reverse 5"},    // route to NOTHING, since missing _part 4
      {"_sequence":"seqid_0", "_part":3, "test":"non reverse 3"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":2, "test":"non reverse 2"},    // route to 2 since 0 part is such
      {"_sequence":"seqid_0", "_part":0, "test":"reverse Example", "intcase": 64}, // route to 2  -reversible string
      {"_sequence":"seqid_0", "_part":1, "test":"non reverse 1"},    // route to 2 since 0 part is such
      {"test": "message Example"},   // route to 2 as reversible nonseq
      {"test": "message", "int_value": 512},          // route to 3 as integer
      {"test": "message"},          // route to 4 as nonreversable string
      { "test": "not reverse", "str": ucs2str, "int_value": 512, "_hash":"str" }             // route to 1 as hash
    ];
    var queued = []
    var clients=[];
    for (var i =0; i < objects.length; i++){
      clients.push(getServiceClient(hostname,port));
      queued.push(clients[i].enqueue(JSON.stringify(objects[i])));
    }
    Promise.all(queued).then((vals)=>{ // responses complete
      var nexts=[
        clients[0].next(0),
        clients[2].next(2),
        clients[3].next(2),
        clients[4].next(2),
        clients[5].next(2),
        clients[6].next(2),
        clients[7].next(3),
        clients[8].next(4),
        clients[9].next(1),
      ];
      return Promise.all(nexts);
    }, (err)=>{
      assert.equal(!err,true);
      server.close(done); // close server
    })
    .then((results)=>{
      results = results.map(JSON.parse); assert.equal(results[0]['_special'],"nonempty"); assert.equal(results[1]['test'],"elpmaxE esrever");
      assert.equal(results[2]['test'],"non reverse 1");
      assert.equal(results[3]['test'],"non reverse 2");
      assert.equal(results[4]['test'],"elpmaxE egassem");
      assert.equal(results[5]['test'],"non reverse 3");
      assert.equal(results[6]['int_value'],-513);
      assert.equal(results[7]['test'],"message");
      assert.equal(results[8]["hash"] ,sha256(btoa(utf8.encode(ucs2str))));
      server.close(done); // close server
    },
    (err)=>{
      console.log(err.stack);
      server.close(done); // close server
      assert.equal(!err,true);
    }).catch((e)=>{
      done(e);
    });
  });
});
