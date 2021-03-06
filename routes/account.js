var _ = require('underscore'),
    moment = require('moment'),
    ObjectID = require('mongoskin').ObjectID,
    async = require('async');

/**
 * Account based route handling
 * @param object db  MongoSkin db instance
 */
function Account(db){

    /**
     * Bind custon method to accout collection
     * - Maps _id to id
     * - Calcs balance
     */
    db.bind('account', {
        byId: function(id, fn){

            this.findById(id, function(err, result){

                if(!_.isEmpty(result)){
                    result.id = result._id;
                    delete result._id;

                    var balance = 0;

                    _.each(result.transactions, function(item, index){

                        //Check if we're adding or subtracting
                        if(item.withdrawal)
                            balance -= parseFloat(item.amount, 10);
                        else if(item.deposit)
                            balance += parseFloat(item.amount, 10);

                    });

                    result.balance =  Math.round(balance * 100) / 100;

                }

                fn(err, result);
            });

        }
    });

    var self = this,
        allowedUpdates = ['loan_rate', 'saving_rate', 'pocket_money_amount', 'pocket_money_day', 'goal']; //Fields allowed to be set during update

    var collection = db.collection('account');

    /**
     * Create account
     * @param  Object   req  Express Request object
     * @param  Object   res  Express Request object
     * @param  Function next Goto next middleware/route
     * @return void
     */
    this.createAccount = function(req, res, next) {

        //Validate post fields
        req.checkBody('parent_name', 'Invalid parent name').notEmpty();
        req.checkBody('child_name', 'Invalid child name').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        var toInsert = {
            "parent_name": req.body.parent_name,
            "child_name": req.body.child_name,
            "start_date": new Date(),
            "current_date": req.body.current_date || new Date()
        };

        collection.insert(toInsert, {}, function(e, results){
            if (e) return next(e);

            res.json({'id':results[0]._id});
        });

    };

    /**
     * Delete account
     * @param  Object   req  Express Request object
     * @param  Object   res  Express Request object
     * @param  Function next Goto next middleware/route
     * @return void
     */
    this.deleteAccount = function(req, res, next) {

        req.checkBody('id', 'Invalid id').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        collection.removeById(req.body.id, {}, function(e, results){
            if (e) return next(e);

            if(results === 1)
                res.json({"deleted": req.body.id});
            else
                res.json(404, {"error": 'Nothing to delete'});
        });

    };

    /**
     * Read account
     * @param  Object   req  Express Request object
     * @param  Object   res  Express Request object
     * @param  Function next Goto next middleware/route
     * @return void
     */
    this.readAccount =  function(req, res, next) {

        req.assert('id', 'Invalid id').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        collection.byId(req.params.id, function(e, result){
            if (e) return next(e);

            if(!_.isEmpty(result)){
                res.json(result);
            }else{
                res.json(404, {"error": 'No account found'});
            }
        });

    };

    /**
     * Get accounts
     * @param  Object   req  Express Request object
     * @param  Object   res  Express Request object
     * @param  Function next Goto next middleware/route
     * @return void
     */
    this.getAccounts =  function(req, res, next) {

        collection.find({}).toArray(function(e, result){
            if (e) return next(e);

            if(!_.isEmpty(result)){

                var formatted = _.map(result, function(item){
                item.id = item._id;
                delete item._id;

                return item;
            });
                res.json(formatted);
            }else{
                res.json(404, {"error": 'No account found'});
            }
        });

    };

    /**
     * Update account
     * @param  Object   req  Express Request object
     * @param  Object   res  Express Request object
     * @param  Function next Goto next middleware/route
     * @return void
     */
    this.updateAccount = function(req, res, next) {

        req.checkBody('id', 'Invalid id').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        var id = req.body.id;
        var update = _.pick(req.body, allowedUpdates); //Filter update fields

        delete update.id;

        collection.updateById(id, { $set : update }, function(e, result){
            if (e) return next(e);

             if(result === 1){
                collection.byId(id, function(e, result){

                    if(result)
                        res.json(result);
                });

            }else{
                res.json(404, {"error": 'Invalid account id'});
            }
        });

    };

    /**
     * Increment an account date by specified days
     * @param  Object   req  Express Request object
     * @param  Object   res  Express Request object
     * @param  Function next Goto next middleware/route
     * @return void
     */
    this.incrementAccount = function(req, res, next) {

        req.checkBody('days', 'Invalid days parameter').notEmpty();
        req.checkBody('days', 'Invalid days parameter').isInt();
        req.checkBody('id', 'Invalid id').notEmpty();

        var days = req.body.days;

        if(self.handleErrors(req.validationErrors(), res))
            return;

        collection.byId(req.body.id, function(e, account){
            if (e) return next(e);

            if(_.isEmpty(account))
                return res.json(404, {"error": 'Invalid account id'});

            //Do each task in order
            async.series([
                function(callback){
                    self.calculatePocketMoneyAndInterest(account, days, callback);
                },
                function(callback){
                    self.updateCurrentDate(account, days, callback);
                }
            ], function(){
                collection.byId(req.body.id, function(e, updatedAccount){
                    res.json(updatedAccount);
                });
            });
        });

    };

    /**
     * Calculate Pocket money and Interest
     * - Every time we pass pocket money day add a pocket money transaction
     * - Every time we pass monday calculate interest
     * @param  Object   account
     * @param  int   days
     * @param  Function callback
     * @return void
     */
    this.calculatePocketMoneyAndInterest = function(account, days, callback) {

        var start = moment.utc(account.current_date), //parse as UTC (because it is!)
            queue = async.queue(self.addTransaction, 1),
            balance = account.balance; //Use an async queue to manage transaction callbacks

        //Step through days one by one
        for (var i = days; i >= 0; i--) {

            //Increment date
            start.add('days', 1);

            var clone = start.clone();

            //It's pocket money day
            if(parseInt(account.pocket_money_day,10) === parseInt(start.format('d'), 10)){

                //Add pocket money transaction
                queue.push({
                    "accountId": account.id,
                    "amount": parseFloat(account.pocket_money_amount),
                    "description": 'Pocket Money (auto)',
                    "deposit": true,
                    "withdrawal": false,
                    "date": clone.toDate() //make sure you clone() so we get a new instance
                });

                //Update running balance
                balance += parseFloat(account.pocket_money_amount);

            }

            //It's monday so add some interest
            if(1 === parseInt(start.format('d'), 10)){

                //Saving or Loan rate?
                if(balance >= 0){

                    //Divide rate by 52 to get weekly rate
                    interestRate = account.saving_rate / 52;

                    //Calculate interest based on current balance
                    interest = (balance / 100) * interestRate;

                    //Round to 2 decimal places
                    interest = Math.round(interest * 100) / 100;

                    //Add transaction to queue
                    queue.push({
                        "accountId": account.id,
                        "amount": interest,
                        "description": 'Interest payment (auto)',
                        "deposit": true,
                        "withdrawal": false,
                        "date": clone.toDate()
                    });

                    //Update balance we've got so we don't need to query data again
                    balance += interest;

                }else{

                    //Divide rate by 52 to get weekly rate
                    interestRate = account.loan_rate / 52;

                    //Calculate interest based on current balance
                    interest = (balance / 100) * interestRate;

                    //Round to 2 decimal places
                    interest = Math.round(interest * 100) / 100;

                    //Add transaction to queue
                    queue.push({
                        "accountId": account.id,
                        "amount": Math.abs(interest),
                        "description": 'Interest payment (auto)',
                        "deposit": false,
                        "withdrawal": true,
                        "date": clone.toDate()
                    });

                    //Update balance we've got so we don't need to query data again
                    balance -= interest;
                }

            }
        }

        //If there are no transactions to add just move on
        if(queue.length() < 1)
            callback();

        //When the queue's finished
        queue.drain = function(){
            callback();
        };
    };

    /**
     * Update the account's current date by x days
     * @param  Object   account
     * @param  int   days
     * @param  Function callback
     * @return void
     */
    this.updateCurrentDate = function(account, days, callback){

        var start = moment(account.current_date);
        start.add('days', days);

        var update = {current_date: start.toDate()};

        collection.updateById(account.id, { $set : update }, function(e, result){
            if (e) return next(e);

            callback();
        });
    };

    /**
     * Add transaction to acccount
     * - For use as a ASYNC queue worker
     * @param Object   transaction
     * @param Function callback
     */
    this.addTransaction = function(transaction, callback) {

        var accountId = transaction.accountId;

        delete transaction.accountId;

        collection.updateById(accountId, { $push: { "transactions": transaction }}, function(e, update){
            if (e) return callback(e);

            callback();

        });
    };

    /**
     * Helper to handle validation errors
     * @param  array errors
     * @param  object res
     * @return void
     */
    this.handleErrors = function(errors, res){

        if (errors) {
            res.json(400, {"error": true, "messages": errors});
            return true;
        }else{
            return false;
        }
    };
}

module.exports = Account;