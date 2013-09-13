var _ = require('underscore');

/**
 * Account based route handling
 * @param object db  MongoSkin db instance
 */
function Account(db){

    var self = this,
        allowedUpdates = ['loan_rate', 'saving_rate', 'pocket_money_amount', 'pocket_money_day']; //Fields allowed to be set during update

    this.createAccount = function(req, res, next) {

        //Validate post fields
        req.checkBody('parent_name', 'Invalid parent name').notEmpty();
        req.checkBody('child_name', 'Invalid child name').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        var collection = db.collection('account');

        var toInsert = {
            "parent_name": req.body.parent_name,
            "child_name": req.body.child_name,
            "start_date": new Date()
        };

        collection.insert(toInsert, {}, function(e, results){
            if (e) return next(e);

            res.json({'id':results[0]._id});
        });

    };

    this.deleteAccount = function(req, res, next) {

        req.checkBody('id', 'Invalid id').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        var collection = db.collection('account');

        collection.removeById(req.body.id, {}, function(e, results){
            if (e) return next(e);

            if(results === 1)
                res.json({"deleted": req.body.id});
            else
                res.json(404, {"error": 'Nothing to delete'});
        });

    };

    this.readAccount =  function(req, res, next) {

        req.assert('id', 'Invalid id').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        var collection = db.collection('account');

        collection.byId(req.params.id, function(e, result){
            if (e) return next(e);

            if(!_.isEmpty(result)){
                res.json(result);
            }else{
                res.json(404, {"error": 'No account found'});
            }
        });

    };

    this.updateAccount = function(req, res, next) {

        req.checkBody('id', 'Invalid id').notEmpty();

        if(self.handleErrors(req.validationErrors(), res))
            return;

        var collection = db.collection('account');

        var id = req.body.id;
        var update = _.pick(req.body, allowedUpdates); //Filter update fields

        delete update.id;

        collection.updateById(id, { $set : update }, function(e, result){
            if (e) return next(e);

             if(result === 1){
                collection.findById(id, function(e, result){

                    if(result)
                        res.json(result);
                });

            }else{
                res.json(404, {"error": 'Invalid account id'});
            }
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