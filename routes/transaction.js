var _ = require('underscore'),
    moment = require('moment');

/**
 * Transaction based route handling
 * @param object db  MongoSkin db instance
 */
function Transaction(db){

    var self = this;

    var collection = db.collection('account');

    this.createTransaction = function(req, res, next) {

        req.checkBody('account_id', 'You must specify an account').notEmpty();
        req.checkBody('amount', 'You must specify an amount').notEmpty();
        req.checkBody('description', 'You must specify a description').notEmpty();

        //Sanitize boolean inputs
        req.sanitize('deposit').toBooleanStrict();
        req.sanitize('withdrawal').toBooleanStrict();
        req.body.deposit = (req.body.deposit === undefined) ? false : req.body.deposit;
        req.body.withdrawal = (req.body.withdrawal === undefined) ? false : req.body.withdrawal;

        if(self.handleErrors(req.validationErrors(), res))
            return;

        var newTransaction = {
            "amount": req.body.amount,
            "description": req.body.description,
            "deposit": req.body.deposit,
            "withdrawal": req.body.withdrawal,
            "date": moment(req.body.date).toDate() || new Date() // set detfault to now
        };

        collection.byId(req.body.account_id, function(e, result) {
            if (e) return next(e);

            if(!_.isEmpty(result)){

                collection.updateById(result.id, { $push: { "transactions": newTransaction }}, function(e, update){
                    if (e) return next(e);

                    if(update == 1){
                        collection.findById(result.id, function(e, updated){
                            if (e) return next(e);

                            if(!_.isEmpty(updated))
                                res.json(updated);
                            else
                                res.json(500, {'error': true});
                        });
                    }else{
                        res.json(500, {'error': true});
                    }
                });

            }else{
                 res.json(404, {"error": 'Invalid account id'});
            }

        });
    };

    this.getTransactions = function(req, res, next) {

        req.assert('id', 'Invalid account id').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        collection.findById(req.params.id, {transactions:true, _id:false}, function(e, result) {
            if (e) return next(e);

            if(!_.isEmpty(result))
                res.json(result);
            else
                res.json(404, {"error": 'Invalid account id'});
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

module.exports = Transaction;